import express from "express";
import {
  CreateRazorpayOrder,
  RazorpayWebhook,
  RefundRazorpayPayment,
  RetryRazorpayOrder,
  VerifyRazorpayPayment,
} from "./payment.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { paymentRateLimit, refundRateLimit } from "../../middleware/rate-limit.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const router = express.Router();

router.post("/razorpay/order", paymentRateLimit, TokenVerify, CreateRazorpayOrder);
router.post("/razorpay/verify", paymentRateLimit, TokenVerify, VerifyRazorpayPayment);
router.post("/razorpay/retry/:intentId", paymentRateLimit, TokenVerify, RetryRazorpayOrder);
// Was TokenVerify-only: any admin-tier role (even one with no orders:manage
// permission) could refund any paid order via a direct API call.
//
// The rate limit was also missing here while every other payment route had one —
// on the endpoint that moves real money irreversibly. It caps how fast a
// duplicate-refund race can be attempted; the atomic claim in the controller is
// what actually decides the winner.
router.post(
  "/razorpay/refund/:orderId",
  refundRateLimit,
  TokenVerify,
  requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE),
  RefundRazorpayPayment,
);
// The webhook is intentionally unlimited: it is authenticated by signature and
// Razorpay retries on failure, so a 429 would drop payment confirmations.
router.post("/razorpay/webhook", RazorpayWebhook);

export default router;
