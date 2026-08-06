import express from "express";
import {
  CreateRazorpayOrder,
  RazorpayWebhook,
  RefundRazorpayPayment,
  RetryRazorpayOrder,
  VerifyRazorpayPayment,
} from "./payment.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { paymentRateLimit } from "../../middleware/rate-limit.middleware.js";

const router = express.Router();

router.post("/razorpay/order", paymentRateLimit, TokenVerify, CreateRazorpayOrder);
router.post("/razorpay/verify", paymentRateLimit, TokenVerify, VerifyRazorpayPayment);
router.post("/razorpay/retry/:intentId", paymentRateLimit, TokenVerify, RetryRazorpayOrder);
router.post("/razorpay/refund/:orderId", TokenVerify, RefundRazorpayPayment);
// The webhook is intentionally unlimited: it is authenticated by signature and
// Razorpay retries on failure, so a 429 would drop payment confirmations.
router.post("/razorpay/webhook", RazorpayWebhook);

export default router;
