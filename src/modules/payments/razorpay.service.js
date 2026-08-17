import crypto from "node:crypto";
import Razorpay from "razorpay";
import { isPaymentEnabled } from "../../config/features.config.js";
import { orderError } from "../orders/order-pricing.service.js";

let razorpayInstance;

export const getRazorpay = () => {
  if (!isPaymentEnabled()) {
    throw orderError("Razorpay payments are disabled by configuration", 503);
  }

  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    throw orderError("Razorpay test credentials are not configured", 503);
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  return { razorpay: razorpayInstance, keyId, keySecret };
};

export const createRazorpayReceipt = (prefix = "kitab") =>
  `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

export const isValidSignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  signature,
  secret,
}) => {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(String(signature || ""), "utf8");

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
};

export const isValidWebhookSignature = ({ body, signature, secret }) => {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
};

export const getRazorpayErrorMessage = (error) =>
  error?.error?.description ||
  error?.error?.reason ||
  error?.message ||
  "Razorpay request failed";

/**
 * Removed in favour of `refundOrphanedCapture` in orphaned-capture.service.js.
 *
 * This helper refunded a captured payment but recorded NOTHING, so a refund that
 * then failed left no trace of the liability — and only the browser-verify path
 * ever called it, which is why the webhook path had no compensation at all. The
 * replacement records the orphaned capture first, is idempotent on the payment
 * id, and tags the gateway call for reconciliation.
 */
