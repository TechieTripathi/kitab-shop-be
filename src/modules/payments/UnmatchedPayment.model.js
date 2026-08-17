import mongoose from "mongoose";

/**
 * A payment the gateway captured that this system could NOT turn into an order.
 *
 * Money arrived, the customer is owed either goods or a refund, and there was no
 * record of it anywhere. That gap was reachable two ways, both on the webhook
 * path — which is the path that exists precisely for when the browser never
 * comes back:
 *
 *   1. The order row was already swept to Cancelled/Failed (20 minutes after
 *      checkout started), so the promotion compare-and-swap could no longer
 *      match. `completeCapturedIntent` threw 409, the handler answered 500,
 *      Razorpay retried into the same 409 and eventually gave up.
 *   2. The PaymentIntent had passed its retention TTL and been deleted, so the
 *      handler found nothing to promote and returned **200** — reporting success
 *      for a payment it had silently dropped.
 *
 * The browser-verify path already compensated by auto-refunding; the webhook did
 * not. This collection is the durable half of closing that gap: every orphaned
 * capture is recorded before the refund is attempted, so the liability exists in
 * the data even if the refund itself then fails.
 *
 * The unique index is the idempotency guard, and it is doing real work: webhook
 * deliveries are retried, so two concurrent handlers race to insert and exactly
 * one wins. The loser adopts the existing row instead of issuing a second
 * refund — the same primitive the `webhookevents` replay guard uses, for the
 * same reason.
 */
const unmatchedPaymentSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ["razorpay"],
      default: "razorpay",
    },
    // The gateway's payment id. Globally unique at the provider, which is what
    // makes it a safe idempotency key even when we have no intent and no order.
    paymentId: {
      type: String,
      required: true,
    },
    // The gateway order id the payment was made against, kept for dashboard
    // lookups even when the intent it belonged to is long gone.
    providerOrderId: { type: String, default: "" },
    paymentIntent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentIntent",
      default: null,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
    /** Paise, exactly as the gateway reported it. */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    /** Why the capture could not be turned into an order. */
    detectedReason: { type: String, default: "" },
    /**
     * `pending`   recorded, refund not yet attempted (or the attempt is in flight)
     * `refunded`  the gateway confirmed the money went back
     * `failed`    the refund attempt was rejected — needs a human
     * `resolved`  an operator settled it another way (shipped the goods, manual refund)
     */
    resolution: {
      type: String,
      enum: ["pending", "refunded", "failed", "resolved"],
      default: "pending",
    },
    refundId: {
      type: String,
      set: (value) => (value === "" || value === null ? undefined : value),
    },
    failureReason: { type: String, default: "" },
    attempts: { type: Number, default: 0, min: 0 },
    /**
     * When the gateway was last actually called for this capture.
     *
     * Claimed with a conditional update, so concurrent webhook deliveries cannot
     * all refund. Winning the unique-index insert decides who OWNS the record;
     * this decides who may call Razorpay right now. The loser of the insert would
     * otherwise read a `pending` row and refund it itself.
     */
    lastAttemptAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

unmatchedPaymentSchema.index({ provider: 1, paymentId: 1 }, { unique: true });
// Backs the admin health check's "how many are still outstanding?" count.
unmatchedPaymentSchema.index({ resolution: 1, createdAt: -1 });

export default mongoose.model("UnmatchedPayment", unmatchedPaymentSchema);
