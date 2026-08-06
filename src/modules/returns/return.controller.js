import mongoose from "mongoose";
import OrderModel from "../orders/Order.model.js";
import ProductModel from "../products/Product.model.js";
import ReturnModel, { RETURN_STATUSES } from "./return.model.js";
import UserModel from "../../model/User.model.js";
import { createAuditLog } from "../audit/audit-log.js";
import { notifyRefundProcessed, notifyReturnUpdated } from "../notifications/notification.service.js";
import { hasAdminRole } from "../../config/admin-permissions.config.js";
const STATUS_TRANSITIONS = {
  pending: ["approved", "rejected"],
  approved: ["pickup_scheduled", "rejected"],
  pickup_scheduled: ["received"],
  received: ["refunded"],
  refunded: [],
  rejected: [],
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateReturn = (query) =>
  query
    .populate("user", "email roles")
    .populate("product", "name image brand")
    .populate("order", "orderStatus paymentMethod paymentStatus totalAmount createdAt");

const populateReturnLean = (query) => populateReturn(query).lean();

export const CreateReturnRequest = async (req, res) => {
  try {
    const { orderId, productId, quantity = 1, reason, details = "", proofImages = [] } =
      req.body || {};

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }
    if (!String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "Return reason is required" });
    }
    if (!Array.isArray(proofImages)) {
      return res.status(400).json({ success: false, message: "Proof images must be an array" });
    }

    const order = await OrderModel.findById(orderId).select(
      "user orderStatus items",
    );
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.user) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "You cannot return this order" });
    }
    if (order.orderStatus !== "Delivered") {
      return res.status(400).json({
        success: false,
        message: "A return can be requested only after the order is delivered",
      });
    }

    const orderItem = order.items.find(
      (item) => String(item.product) === String(productId),
    );
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: "Product was not found in this order",
      });
    }

    const returnQuantity = Number.parseInt(quantity, 10);
    if (
      !Number.isInteger(returnQuantity) ||
      returnQuantity < 1 ||
      returnQuantity > orderItem.quantity
    ) {
      return res.status(400).json({
        success: false,
        message: `Return quantity must be between 1 and ${orderItem.quantity}`,
      });
    }

    const existingReturn = await ReturnModel.findOne({
      order: order._id,
      product: orderItem.product,
      user: req.user.id,
    });
    if (existingReturn) {
      return res.status(409).json({
        success: false,
        message: "A return request already exists for this product",
      });
    }

    const returnRequest = await ReturnModel.create({
      order: order._id,
      user: req.user.id,
      product: orderItem.product,
      productSnapshot: {
        name: orderItem.name,
        image: orderItem.image,
        price: orderItem.price,
      },
      quantity: returnQuantity,
      reason: String(reason).trim(),
      details: String(details || "").trim(),
      proofImages: proofImages.slice(0, 5),
      refundAmount: orderItem.price * returnQuantity,
    });

    await notifyReturnUpdated({
      orderId: order._id,
      userId: req.user.id,
      status: returnRequest.status,
    });

    return res.status(201).json({
      success: true,
      message: "Return request submitted successfully",
      data: returnRequest,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A return request already exists for this product",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetMyReturns = async (req, res) => {
  try {
    const returns = await populateReturn(
      ReturnModel.find({ user: req.user.id }).sort({ createdAt: -1 }),
    ).lean();

    return res.status(200).json({
      success: true,
      total: returns.length,
      data: returns,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetReturnById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    const returnRequest = await populateReturnLean(ReturnModel.findById(req.params.id));
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }

    const isOwner = String(returnRequest.user?._id || returnRequest.user) === String(req.user.id);
    if (!isOwner && !hasAdminRole(req.user)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    return res.status(200).json({ success: true, data: returnRequest });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminGetReturns = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
    const status = String(req.query.status || "all");
    const search = String(req.query.search || "").trim();
    const filter = {};

    if (status !== "all" && RETURN_STATUSES.includes(status)) filter.status = status;

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const [users, products] = await Promise.all([
        UserModel.find({ email: regex }).distinct("_id"),
        ProductModel.find({ name: regex }).distinct("_id"),
      ]);
      filter.$or = [
        { returnNumber: regex },
        { reason: regex },
        { details: regex },
        { "productSnapshot.name": regex },
        { user: { $in: users } },
        { product: { $in: products } },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) {
        filter.$or.push({ _id: search }, { order: search });
      }
    }

    const [returns, total] = await Promise.all([
      populateReturn(
        ReturnModel.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
      ).lean(),
      ReturnModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: returns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminUpdateReturnStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    const status = String(req.body?.status || "");
    const adminNote = String(req.body?.adminNote || "").trim();
    if (!RETURN_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid return status" });
    }

    const returnRequest = await ReturnModel.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }

    const allowedNextStatuses = STATUS_TRANSITIONS[returnRequest.status] || [];
    if (!allowedNextStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Return cannot move from ${returnRequest.status} to ${status}`,
      });
    }

    returnRequest.status = status;
    if (adminNote) returnRequest.adminNote = adminNote;
    if (status === "pickup_scheduled") {
      const pickupDate = req.body?.pickupScheduledAt
        ? new Date(req.body.pickupScheduledAt)
        : new Date();
      returnRequest.pickupScheduledAt = Number.isNaN(pickupDate.getTime())
        ? new Date()
        : pickupDate;
    }
    if (status === "received") returnRequest.receivedAt = new Date();
    if (status === "refunded") returnRequest.refundedAt = new Date();
    returnRequest.statusHistory.push({
      status,
      changedBy: req.user.id,
      note: adminNote,
    });
    await returnRequest.save();
    await notifyReturnUpdated({
      orderId: returnRequest.order,
      userId: returnRequest.user,
      status,
    });
    if (status === "refunded") {
      await notifyRefundProcessed({ orderId: returnRequest.order, paymentId: null });
    }

    await createAuditLog({
      admin: req.user.id,
      action: "UPDATE_RETURN_STATUS",
      module: "RETURN",
      targetId: returnRequest._id,
      targetName: returnRequest.returnNumber,
      description: `Updated ${returnRequest.returnNumber} from ${
        returnRequest.statusHistory.at(-2)?.status || "pending"
      } to ${status}`,
      req,
    });

    const populatedReturn = await populateReturnLean(ReturnModel.findById(returnRequest._id));
    return res.status(200).json({
      success: true,
      message: "Return status updated successfully",
      data: populatedReturn,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
