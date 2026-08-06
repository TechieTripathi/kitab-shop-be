import OrderModel from "../orders/Order.model.js";
import PaymentIntent from "./PaymentIntent.model.js";
import {
  getFeatures,
  isPaymentEnabled,
  isStockEnforced,
} from "../../config/features.config.js";
import {
  notifyPaymentFailed,
  notifyRefundProcessed,
} from "../notifications/notification.service.js";
import { orderError, prepareOrderData } from "../orders/order-pricing.service.js";
import {
  releaseReservation,
  reserveStockForIntent,
} from "../inventory/inventory-reservation.service.js";
import {
  createRazorpayReceipt,
  getRazorpay,
  getRazorpayErrorMessage,
  isValidSignature,
  isValidWebhookSignature,
  refundCapturedPayment,
} from "./razorpay.service.js";
import { completeCapturedIntent } from "./payment-order.service.js";
import { hasAdminRole } from "../../config/admin-permissions.config.js";

const ADMIN_PURCHASE_MESSAGE =
  "Admin accounts cannot place orders. Please use a customer account.";

export const CreateRazorpayOrder = async (req, res) => {
  try {
    if (!isPaymentEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Razorpay payments are disabled for this environment",
        code: "PAYMENTS_DISABLED",
      });
    }

    if (hasAdminRole(req.user)) {
      return res.status(403).json({ success: false, message: ADMIN_PURCHASE_MESSAGE });
    }

    const { items = [], shippingAddress, coupon = null, useWallet, idempotencyKey } = req.body || {};
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
      throw orderError("A valid checkout idempotency key is required");
    }

    const existingIntent = await PaymentIntent.findOne({
      user: req.user.id,
      idempotencyKey,
      status: { $in: ["created", "processing", "completed"] },
    });
    if (existingIntent) {
      const { keyId } = getRazorpay();
      return res.status(200).json({
        success: true,
        data: {
          paymentIntentId: existingIntent._id,
          keyId,
          razorpayOrderId: existingIntent.razorpayOrderId,
          amount: existingIntent.amount,
          currency: existingIntent.currency,
        },
      });
    }
    const preparedOrder = await prepareOrderData({
      items,
      rawShippingAddress: shippingAddress,
      coupon,
      userId: req.user.id,
      redeemCoupon: false,
      useWallet: Boolean(useWallet),
    });
    const amount = Math.round(preparedOrder.totalAmount * 100);
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message: "Razorpay payment amount must be at least Rs 1",
      });
    }

    const { razorpay, keyId } = getRazorpay();
    const receipt = createRazorpayReceipt("astro");
    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt,
      notes: { userId: String(req.user.id), source: "AstroMart Checkout" },
    });

    const intent = await PaymentIntent.create({
      user: req.user.id,
      idempotencyKey,
      razorpayOrderId: razorpayOrder.id,
      amount,
      currency: razorpayOrder.currency || "INR",
      items: preparedOrder.orderItems,
      shippingAddress: preparedOrder.shippingAddress,
      subtotal: preparedOrder.subtotal,
      shippingCharge: preparedOrder.shippingCharge,
      tax: preparedOrder.tax,
      discount: preparedOrder.discount,
      walletDiscount: preparedOrder.walletDiscount,
      couponDiscount: preparedOrder.couponDiscount,
      totalAmount: preparedOrder.totalAmount,
      coupon: preparedOrder.couponId,
    });

    const { inventory } = getFeatures();
    if (inventory.reserveDuringPayment && isStockEnforced()) {
      await reserveStockForIntent({
        userId: req.user.id,
        paymentIntentId: intent._id,
        idempotencyKey,
        items: preparedOrder.orderItems,
      });
      intent.stockReserved = true;
      await intent.save();
    }

    return res.status(201).json({
      success: true,
      data: {
        paymentIntentId: intent._id,
        keyId,
        razorpayOrderId: razorpayOrder.id,
        amount,
        currency: intent.currency,
        receipt,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || error?.statusCode || 500).json({
      success: false,
      message: getRazorpayErrorMessage(error),
    });
  }
};

export const VerifyRazorpayPayment = async (req, res) => {
  let intent;
  let capturedPayment;
  let storeOrder;

  try {
    if (!isPaymentEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Razorpay payments are disabled for this environment",
        code: "PAYMENTS_DISABLED",
      });
    }

    const {
      razorpay_order_id: returnedOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body || {};

    if (!returnedOrderId || !paymentId || !signature) {
      throw orderError("Razorpay payment verification fields are required");
    }

    intent = await PaymentIntent.findOne({
      razorpayOrderId: returnedOrderId,
      user: req.user.id,
    });
    if (!intent) throw orderError("Payment session was not found", 404);

    const { razorpay, keySecret } = getRazorpay();
    if (
      !isValidSignature({
        razorpayOrderId: intent.razorpayOrderId,
        razorpayPaymentId: paymentId,
        signature,
        secret: keySecret,
      })
    ) {
      throw orderError("Payment signature verification failed", 400);
    }

    if (intent.status === "completed" && intent.storeOrder) {
      const existingOrder = await OrderModel.findById(intent.storeOrder);
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        order: existingOrder,
      });
    }

    capturedPayment = await razorpay.payments.fetch(paymentId);
    if (capturedPayment.order_id !== intent.razorpayOrderId) {
      throw orderError("Payment does not belong to this Razorpay order");
    }
    if (
      Number(capturedPayment.amount) !== intent.amount ||
      String(capturedPayment.currency).toUpperCase() !== intent.currency
    ) {
      throw orderError("Paid amount does not match the checkout amount");
    }

    if (capturedPayment.status === "authorized") {
      capturedPayment = await razorpay.payments.capture(
        paymentId,
        intent.amount,
        intent.currency,
      );
    }
    if (capturedPayment.status !== "captured") {
      throw orderError(`Payment is ${capturedPayment.status}, not captured`, 409);
    }

    storeOrder = await completeCapturedIntent({
      intent,
      capturedPayment,
      signature,
    });

    return res.status(201).json({
      success: true,
      message: "Payment verified and order placed successfully",
      order: storeOrder,
    });
  } catch (error) {
    const paymentWasCaptured = capturedPayment?.status === "captured";
    const orderWasCreated = Boolean(storeOrder?._id);

    if (paymentWasCaptured && !orderWasCreated && intent) {
      const { razorpay } = getRazorpay();
      const refunded = await refundCapturedPayment({
        razorpay,
        paymentId: capturedPayment.id,
        amount: intent.amount,
      });
      if (refunded) {
        await releaseReservation({
          paymentIntentId: intent._id,
          reason: "payment_refunded_after_order_failure",
        });
        await notifyRefundProcessed({
          orderId: storeOrder?._id || intent.storeOrder || null,
          paymentId: capturedPayment.id,
        });
      }
      await PaymentIntent.findByIdAndUpdate(intent._id, {
        status: refunded ? "refunded" : "failed",
        failureReason: getRazorpayErrorMessage(error),
      });

      if (!refunded) {
        return res.status(500).json({
          success: false,
          message:
            "Payment was captured but the order could not be created. Contact support with payment ID " +
            capturedPayment.id,
        });
      }

      return res.status(409).json({
        success: false,
        message: `Payment was refunded because the order could not be completed: ${getRazorpayErrorMessage(error)}`,
        code: "RAZORPAY_PAYMENT_REFUNDED",
      });
    }

    await notifyPaymentFailed({
      orderId: storeOrder?._id || intent?.storeOrder || null,
      reason: getRazorpayErrorMessage(error),
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      message: getRazorpayErrorMessage(error),
      code: "RAZORPAY_VERIFICATION_FAILED",
    });
  }
};

export const RetryRazorpayOrder = async (req, res) => {
  try {
    if (!isPaymentEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Razorpay payments are disabled for this environment",
        code: "PAYMENTS_DISABLED",
      });
    }

    const intent = await PaymentIntent.findOne({
      _id: req.params.intentId,
      user: req.user.id,
      status: { $in: ["created", "failed"] },
    });
    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Retryable payment session was not found",
      });
    }

    const { razorpay, keyId } = getRazorpay();
    const receipt = createRazorpayReceipt("retry");
    const razorpayOrder = await razorpay.orders.create({
      amount: intent.amount,
      currency: intent.currency,
      receipt,
      notes: {
        userId: String(req.user.id),
        previousRazorpayOrderId: intent.razorpayOrderId,
      },
    });

    intent.razorpayOrderId = razorpayOrder.id;
    intent.status = "created";
    intent.failureReason = "";
    intent.retryCount += 1;
    await intent.save();

    return res.status(201).json({
      success: true,
      data: {
        paymentIntentId: intent._id,
        keyId,
        razorpayOrderId: intent.razorpayOrderId,
        amount: intent.amount,
        currency: intent.currency,
        receipt,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: getRazorpayErrorMessage(error),
    });
  }
};

export const RefundRazorpayPayment = async (req, res) => {
  try {
    if (!hasAdminRole(req.user)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to refund orders",
      });
    }

    if (!isPaymentEnabled()) {
      return res.status(503).json({
        success: false,
        message: "Razorpay payments are disabled for this environment",
        code: "PAYMENTS_DISABLED",
      });
    }

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.paymentMethod !== "RAZORPAY" || !order.razorpayPaymentId) {
      return res.status(400).json({
        success: false,
        message: "Only Razorpay paid orders can be refunded through this endpoint",
      });
    }

    const amountRupees = Number(req.body?.amount || order.totalAmount);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0 || amountRupees > order.totalAmount) {
      return res.status(400).json({ success: false, message: "Invalid refund amount" });
    }

    const { razorpay } = getRazorpay();
    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: Math.round(amountRupees * 100),
      speed: req.body?.speed || "normal",
      notes: { reason: String(req.body?.reason || "Admin refund").slice(0, 250) },
    });

    order.refunds.push({
      paymentProvider: "razorpay",
      providerRefundId: refund.id,
      providerPaymentId: order.razorpayPaymentId,
      amount: amountRupees,
      reason: String(req.body?.reason || "").trim(),
      status: "processed",
      createdBy: req.user.id,
    });

    const totalRefunded = order.refunds.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    order.paymentStatus = totalRefunded >= order.totalAmount ? "Refunded" : "Partially Refunded";
    await order.save();

    await notifyRefundProcessed({ orderId: order._id, paymentId: order.razorpayPaymentId });

    return res.status(200).json({
      success: true,
      message: "Refund processed",
      refund,
      order,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: getRazorpayErrorMessage(error),
    });
  }
};

export const RazorpayWebhook = async (req, res) => {
  const { payments } = getFeatures();
  if (!isPaymentEnabled() || !payments.razorpayWebhookEnabled) {
    return res.status(200).json({ success: true, message: "Razorpay webhook disabled" });
  }

  try {
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    const signature = req.get("x-razorpay-signature");
    if (!secret || !signature) {
      return res.status(401).json({ success: false, message: "Webhook signature is required" });
    }

    const body = req.rawBody || JSON.stringify(req.body || {});
    if (!isValidWebhookSignature({ body, signature, secret })) {
      return res.status(401).json({ success: false, message: "Invalid webhook signature" });
    }

    const event = req.body?.event;
    const payment = req.body?.payload?.payment?.entity;
    if (event === "payment.captured" && payment?.order_id && payment?.id) {
      const intent = await PaymentIntent.findOne({ razorpayOrderId: payment.order_id });
      if (intent && intent.status !== "completed") {
        await completeCapturedIntent({
          intent,
          capturedPayment: {
            id: payment.id,
            status: "captured",
          },
        });
      }
    }

    if (event === "payment.failed" && payment?.order_id) {
      await PaymentIntent.findOneAndUpdate(
        { razorpayOrderId: payment.order_id },
        { status: "failed", failureReason: payment.error_description || "Payment failed" },
      );
      const intent = await PaymentIntent.findOne({ razorpayOrderId: payment.order_id });
      if (intent) await releaseReservation({ paymentIntentId: intent._id, reason: "payment_failed" });
      await notifyPaymentFailed({ orderId: intent?.storeOrder || null, reason: "Payment failed" });
    }

    return res.status(200).json({ success: true });
  } catch {
    return res.status(200).json({ success: true });
  }
};
