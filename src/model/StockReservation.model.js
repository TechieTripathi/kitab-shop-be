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
    items: {
      type: [reservationItemSchema],
      required: true,
      validate: {
        validator: (value) => value.length > 0,
        message: "Reservation must contain at least one item.",
      },
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

