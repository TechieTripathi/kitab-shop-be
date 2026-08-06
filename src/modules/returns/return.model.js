import crypto from "node:crypto";
import mongoose from "mongoose";

export const RETURN_STATUSES = [
  "pending",
  "approved",
  "pickup_scheduled",
  "received",
  "refunded",
  "rejected",
];

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: RETURN_STATUSES,
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const returnSchema = new mongoose.Schema(
  {
    returnNumber: {
      type: String,
      unique: true,
      index: true,
      default: () =>
        `RET-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      required: true,
    },
    productSnapshot: {
      name: { type: String, required: true, trim: true },
      image: { type: String, default: "" },
      price: { type: Number, required: true, min: 0 },
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    details: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    proofImages: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => images.length <= 5,
        message: "A maximum of 5 proof images is allowed",
      },
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: RETURN_STATUSES,
      default: "pending",
      index: true,
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    pickupScheduledAt: {
      type: Date,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: null,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: () => [{ status: "pending", note: "Return requested" }],
    },
  },
  { timestamps: true },
);

returnSchema.index({ order: 1, product: 1, user: 1 }, { unique: true });
returnSchema.index({ createdAt: -1, status: 1 });
returnSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("ReturnRequest", returnSchema);
