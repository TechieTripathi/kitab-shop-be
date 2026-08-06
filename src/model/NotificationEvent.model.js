import mongoose from "mongoose";

const notificationEventSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      index: true,
    },
    channels: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["skipped", "queued", "sent", "failed"],
      default: "skipped",
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
      index: true,
    },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    message: { type: String, default: "" },
    provider: { type: String, default: "noop" },
    providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

notificationEventSchema.index({ createdAt: -1 });

export default mongoose.model("NotificationEvent", notificationEventSchema);

