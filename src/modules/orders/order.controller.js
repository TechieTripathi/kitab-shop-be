import OrderModel from "./Order.model.js";
import ProductModel from "../products/Product.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import ReferralSetting from "../referral/ReferralSetting.model.js";
import { isStockEnforced } from "../../config/features.config.js";
import { notifyOrderPlaced, notifyRefundProcessed } from "../notifications/notification.service.js";
import { prepareOrderData } from "./order-pricing.service.js";
import {
  cancelShiprocketOrder,
} from "../shipping/shiprocket.service.js";
import { hasAdminRole } from "../../config/admin-permissions.config.js";
import { syncOrderToShiprocketIfEnabled } from "./order-shipping.service.js";

const ADMIN_PURCHASE_MESSAGE =
  "Admin accounts cannot add products to cart or place orders. Please use a customer account.";

export const PlaceOrder = async (req, res) => {
  let session;
  try {
    const userId = req.user.id;
    if (hasAdminRole(req.user)) {
      return res.status(403).json({
        success: false,
        message: ADMIN_PURCHASE_MESSAGE,
      });
    }

    const {
      items = [],
      shippingAddress: rawShippingAddress,
      paymentMethod,
      coupon,
      idempotencyKey,
      useWallet,
    } = req.body;

    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: "A valid checkout idempotency key is required",
      });
    }

    const existingOrder = await OrderModel.findOne({ user: userId, idempotencyKey });
    if (existingOrder) {
      return res.status(200).json({
        success: true,
        message: "Order already placed",
        order: existingOrder,
      });
    }

    if (String(paymentMethod || "cod").toLowerCase() !== "cod") {
      return res.status(400).json({
        success: false,
        message: "Online payments must be completed through Razorpay Checkout",
      });
    }

    const preparedOrder = await prepareOrderData({
      items,
      rawShippingAddress,
      coupon,
      userId,
      redeemCoupon: true,
      useWallet: Boolean(useWallet),
    });

    session = await OrderModel.startSession();
    let order;
    await session.withTransaction(async () => {
      if (isStockEnforced()) {
        for (const item of preparedOrder.orderItems) {
          const stockUpdate = await ProductModel.updateOne(
            { _id: item.product, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { session },
          );
          if (stockUpdate.modifiedCount !== 1) {
            const error = new Error(`${item.name} no longer has enough stock`);
            error.statusCode = 409;
            throw error;
          }
        }
      }

      [order] = await OrderModel.create(
        [{
          user: userId,
          idempotencyKey,
          items: preparedOrder.orderItems,
          shippingAddress: preparedOrder.shippingAddress,
          paymentMethod: "COD",
          paymentStatus: "Pending",
          orderStatus: "Confirmed",
          subtotal: preparedOrder.subtotal,
          shippingCharge: preparedOrder.shippingCharge,
          tax: preparedOrder.tax,
          discount: preparedOrder.discount,
          couponDiscount: preparedOrder.couponDiscount,
          walletDiscount: preparedOrder.walletDiscount,
          totalAmount: preparedOrder.totalAmount,
          coupon: preparedOrder.couponId,
        }],
        { session },
      );

      // Referral Reward Logic: if first order, reward referrer
      const pastOrdersCount = await OrderModel.countDocuments({ user: userId, _id: { $ne: order._id } }).session(session);
      if (pastOrdersCount === 0) {
        const userProfile = await UserProfile.findOne({ userid: userId }).session(session);
        if (userProfile && userProfile.referredBy) {
          const referrerProfile = await UserProfile.findOne({ userid: userProfile.referredBy }).session(session);
          if (referrerProfile) {
            const settings = await ReferralSetting.getSettings();
            referrerProfile.walletBalance = (referrerProfile.walletBalance || 0) + settings.referrerRewardAmount;
            referrerProfile.totalWalletCreditEarned = (referrerProfile.totalWalletCreditEarned || 0) + settings.referrerRewardAmount;
            referrerProfile.totalReferrals = (referrerProfile.totalReferrals || 0) + 1;
            await referrerProfile.save({ session });
          }
        }
      }

      // Deduct Wallet Balance if used
      if (preparedOrder.walletDiscount > 0) {
        await UserProfile.updateOne(
          { userid: userId },
          { $inc: { walletBalance: -preparedOrder.walletDiscount } },
          { session }
        );
      }
    });

    await syncOrderToShiprocketIfEnabled(order);
    await notifyOrderPlaced(order);

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    if (error?.code === 11000 && req.body?.idempotencyKey) {
      const order = await OrderModel.findOne({
        user: req.user.id,
        idempotencyKey: req.body.idempotencyKey,
      });
      if (order) {
        return res.status(200).json({ success: true, message: "Order already placed", order });
      }
    }
    console.log(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (session) await session.endSession();
  }
};

export const GetMyOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await OrderModel.find({ user: userId })
      .populate("items.product", "name image price mrp brand category_id")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetAllOrders = async (req, res) => {
  try {
    const orders = await OrderModel.find()
      .populate("user", "email roles")
      .populate("items.product", "name image price mrp brand category_id")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetSingleOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderModel.findById(orderId)
      .populate("user", "email roles")
      .populate("items.product", "name image price mrp brand category_id")
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const isOwner = String(order.user?._id || order.user) === req.user.id;
    const isAdmin = hasAdminRole(req.user);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const UpdateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { orderStatus } = req.body;

    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Packed",
      "Shipped",
      "Out For Delivery",
      "Delivered",
      "NDR",
      "RTO",
      "Cancelled",
    ];

    if (!allowedStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status",
      });
    }

    const order = await OrderModel.findByIdAndUpdate(
      orderId,
      { orderStatus },
      { new: true },
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const AddOrderNote = async (req, res) => {
  try {
    const note = String(req.body?.note || "").trim();
    if (!note) {
      return res.status(400).json({ success: false, message: "Note is required" });
    }

    const order = await OrderModel.findByIdAndUpdate(
      req.params.orderId,
      {
        $push: {
          adminNotes: {
            note,
            createdBy: req.user.id,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    return res.status(200).json({
      success: true,
      message: "Order note added",
      order,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const PartialCancelOrder = async (req, res) => {
  let session;
  try {
    const { productId, quantity, reason = "" } = req.body || {};
    const cancelQuantity = Number(quantity);
    if (!productId || !Number.isInteger(cancelQuantity) || cancelQuantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Product id and positive whole-number quantity are required",
      });
    }

    session = await OrderModel.startSession();
    let order;
    await session.withTransaction(async () => {
      order = await OrderModel.findById(req.params.orderId).session(session);
      if (!order) {
        const error = new Error("Order not found");
        error.statusCode = 404;
        throw error;
      }
      if (["Delivered", "Cancelled"].includes(order.orderStatus)) {
        const error = new Error("This order cannot be partially cancelled");
        error.statusCode = 409;
        throw error;
      }

      const item = order.items.find((entry) => String(entry.product) === String(productId));
      if (!item) {
        const error = new Error("Product was not found in this order");
        error.statusCode = 404;
        throw error;
      }

      const remainingQuantity = item.quantity - (item.cancelledQuantity || 0);
      if (cancelQuantity > remainingQuantity) {
        const error = new Error(`Only ${remainingQuantity} item(s) can be cancelled`);
        error.statusCode = 400;
        throw error;
      }

      item.cancelledQuantity = (item.cancelledQuantity || 0) + cancelQuantity;
      const refundAmount = item.price * cancelQuantity;
      order.cancellations.push({
        product: item.product,
        quantity: cancelQuantity,
        reason: String(reason).trim(),
        refundAmount,
        cancelledBy: req.user.id,
      });

      if (isStockEnforced()) {
        await ProductModel.updateOne(
          { _id: item.product },
          { $inc: { stock: cancelQuantity } },
          { session },
        );
      }

      const totalRemaining = order.items.reduce(
        (sum, entry) => sum + (entry.quantity - (entry.cancelledQuantity || 0)),
        0,
      );
      if (totalRemaining === 0) {
        order.orderStatus = "Cancelled";
      }

      if (order.paymentStatus === "Paid") {
        order.paymentStatus = refundAmount >= order.totalAmount ? "Refunded" : "Partially Refunded";
        order.refunds.push({
          paymentProvider: order.paymentMethod === "RAZORPAY" ? "razorpay" : "manual",
          providerPaymentId: order.razorpayPaymentId || "",
          amount: refundAmount,
          reason: String(reason || "Partial cancellation").trim(),
          status: "created",
          createdBy: req.user.id,
        });
      }

      await order.save({ session });
    });

    await notifyRefundProcessed({
      orderId: order._id,
      paymentId: order.razorpayPaymentId || null,
    });

    return res.status(200).json({
      success: true,
      message: "Order item cancelled",
      order,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (session) await session.endSession();
  }
};

export const CreateSplitShipment = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Shipment items are required",
      });
    }

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (["Cancelled", "Delivered"].includes(order.orderStatus)) {
      return res.status(409).json({
        success: false,
        message: "Cannot split this order in its current status",
      });
    }

    const shipmentItems = [];
    for (const requested of items) {
      const quantity = Number(requested.quantity);
      const orderItem = order.items.find(
        (entry) => String(entry.product) === String(requested.productId || requested.product),
      );
      if (!orderItem || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Each shipment item must match an order product and positive quantity",
        });
      }
      shipmentItems.push({ product: orderItem.product, quantity });
    }

    order.shipments.push({
      shipmentNumber: `SHP-${Date.now()}-${order.shipments.length + 1}`,
      items: shipmentItems,
      status: "planned",
      createdBy: req.user.id,
    });
    await order.save();

    return res.status(201).json({
      success: true,
      message: "Split shipment planned",
      order,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const CancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await OrderModel.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (order.orderStatus !== "Pending" && order.orderStatus !== "Confirmed") {
      return res.status(400).json({
        success: false,
        message: "Order cannot be cancelled",
      });
    }

    if (order.shiprocket?.orderId && isShippingEnabled() && isShiprocketConfigured()) {
      try {
        await cancelShiprocketOrder(order.shiprocket.orderId);
      } catch (error) {
        return res.status(error.statusCode || 502).json({
          success: false,
          message: `Order was not cancelled because Shiprocket cancellation failed: ${error.message}`,
        });
      }
    }

    for (const item of order.items) {
      await ProductModel.findByIdAndUpdate(item.product, {
        $inc: { stock: item.quantity },
      });
    }

    order.orderStatus = "Cancelled";
    if (order.shiprocket?.orderId) {
      order.shiprocket.syncStatus = "cancelled";
      order.shiprocket.status = "CANCELLED";
      order.shiprocket.lastError = null;
      order.shiprocket.lastSyncedAt = new Date();
    }
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
