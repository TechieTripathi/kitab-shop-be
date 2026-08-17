import mongoose from "mongoose";

const reservationItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      required: true,
    },
    variantKey: { type: String, default: "" },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const stockReservationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      index: true,
    },
    paymentIntent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentIntent",
      default: null,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
    // Starts EMPTY and is appended to as each product's stock is successfully
    // deducted, so this list always describes what was actually taken.
    //
    // The old "must contain at least one item" validator forced the whole list to
    // be known before the row could exist, which meant stock had to be deducted
    // first and the row written afterwards — and a crash in between deducted units
    // with no record anywhere, leaking them permanently (the expiry job can only
    // release reservations it can find). An empty list is now a legitimate
    // transient state meaning "row exists, nothing taken yet"; releasing it
    // correctly restocks nothing.
    items: {
      type: [reservationItemSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["active", "committed", "released", "expired"],
      default: "active",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    releasedAt: { type: Date, default: null },
    committedAt: { type: Date, default: null },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);

stockReservationSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

export default mongoose.model("StockReservation", stockReservationSchema);

