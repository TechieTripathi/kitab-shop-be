import mongoose from "mongoose";
import { isStockEnforced } from "../../config/features.config.js";
import OrderModel from "../orders/Order.model.js";
import PaymentIntent from "./PaymentIntent.model.js";
import ProductModel from "../products/Product.model.js";
import ReferralSetting from "../referral/ReferralSetting.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import { calculateCouponDiscount } from "../coupons/coupon.service.js";
import {
  notifyOrderPlaced,
  notifyPaymentSuccess,
} from "../notifications/notification.service.js";
import { orderError } from "../orders/order-pricing.service.js";
import {
  commitReservation,
  findActiveReservationForIntent,
} from "../inventory/inventory-reservation.service.js";
import { syncOrderToShiprocketIfEnabled } from "../orders/order-shipping.service.js";
import { logLifecycleEvent } from "../../utils/lifecycle-logger.service.js";

const rewardReferrerForFirstOrder = async ({ userId, orderId, session }) => {
  const pastOrdersCount = await OrderModel.countDocuments({
    user: userId,
    _id: { $ne: orderId },
  }).session(session);
  if (pastOrdersCount !== 0) return;

  const userProfile = await UserProfile.findOne({ userid: userId }).session(session);
  if (!userProfile?.referredBy) return;

  const referrerProfile = await UserProfile.findOne({ userid: userProfile.referredBy }).session(session);
  if (!referrerProfile) return;

  const settings = await ReferralSetting.getSettings();
  const rewardAmount = Number(settings.referrerRewardAmount || 0);
  if (rewardAmount <= 0) return;

  referrerProfile.walletBalance = (referrerProfile.walletBalance || 0) + rewardAmount;
  referrerProfile.totalWalletCreditEarned =
    (referrerProfile.totalWalletCreditEarned || 0) + rewardAmount;
  referrerProfile.totalReferrals = (referrerProfile.totalReferrals || 0) + 1;
  await referrerProfile.save({ session });
};

export const completeCapturedIntent = async ({ intent, capturedPayment, signature = "" }) => {
  let storeOrder;
  logLifecycleEvent("payment", "complete_captured_intent_started", {
    intentId: intent?._id,
    paymentId: capturedPayment?.id,
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const currentIntent = await PaymentIntent.findById(intent._id).session(session);
      if (!currentIntent) throw orderError("Payment session expired", 404);

      if (currentIntent.status === "completed" && currentIntent.storeOrder) {
        storeOrder = await OrderModel.findById(currentIntent.storeOrder).session(session);
        return;
      }
      if (!["created", "processing"].includes(currentIntent.status)) {
        throw orderError(`Payment session is ${currentIntent.status}`, 409);
      }

      currentIntent.status = "processing";
      currentIntent.razorpayPaymentId = capturedPayment.id;
      await currentIntent.save({ session });

      const activeReservation = await findActiveReservationForIntent(currentIntent._id);
      if (isStockEnforced() && !activeReservation) {
        for (const item of currentIntent.items) {
          const stockUpdate = await ProductModel.updateOne(
            { _id: item.product, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { session },
          );
          if (stockUpdate.modifiedCount !== 1) {
            throw orderError(`${item.name} no longer has enough stock`, 409);
          }
        }
      }

      if (currentIntent.coupon) {
        await calculateCouponDiscount({
          couponId: currentIntent.coupon,
          userId: currentIntent.user,
          items: currentIntent.items,
          redeem: true,
          session,
        });
      }

      [storeOrder] = await OrderModel.create(
        [
          {
            user: currentIntent.user,
            items: currentIntent.items,
            shippingAddress: currentIntent.shippingAddress,
            paymentMethod: "RAZORPAY",
            paymentStatus: "Paid",
            orderStatus: "Confirmed",
            subtotal: currentIntent.subtotal,
            shippingCharge: currentIntent.shippingCharge,
            tax: currentIntent.tax,
            discount: currentIntent.discount,
            walletDiscount: currentIntent.walletDiscount,
            couponDiscount: currentIntent.couponDiscount,
            totalAmount: currentIntent.totalAmount,
            coupon: currentIntent.coupon,
            razorpayOrderId: currentIntent.razorpayOrderId,
            razorpayPaymentId: capturedPayment.id,
            razorpaySignature: signature,
            paymentVerifiedAt: new Date(),
          },
        ],
        { session },
      );

      await rewardReferrerForFirstOrder({
        userId: currentIntent.user,
        orderId: storeOrder._id,
        session,
      });

      if (currentIntent.walletDiscount > 0) {
        await UserProfile.updateOne(
          { userid: currentIntent.user },
          { $inc: { walletBalance: -currentIntent.walletDiscount } },
          { session },
        );
      }

      currentIntent.status = "completed";
      currentIntent.storeOrder = storeOrder._id;
      currentIntent.expiresAt = undefined;
      await currentIntent.save({ session });
      if (activeReservation) {
        await commitReservation({ paymentIntentId: currentIntent._id, session });
      }
    });
  } finally {
    await session.endSession();
  }

  await syncOrderToShiprocketIfEnabled(storeOrder);
  await notifyPaymentSuccess(storeOrder);
  await notifyOrderPlaced(storeOrder);
  logLifecycleEvent("payment", "complete_captured_intent_finished", {
    intentId: intent?._id,
    paymentId: capturedPayment?.id,
    orderId: storeOrder?._id,
  });
  return storeOrder;
};
