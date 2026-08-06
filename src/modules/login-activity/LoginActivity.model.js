import mongoose from "mongoose";

const loginActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      index: true,
    },
    ipAddress: {
      type: String,
      default: "Unknown",
    },
    browser: {
      type: String,
      default: "Unknown",
    },
    operatingSystem: {
      type: String,
      default: "Unknown",
    },
    device: {
      type: String,
      default: "Desktop",
    },
    location: {
      country: { type: String, default: "" },
      region: { type: String, default: "" },
      city: { type: String, default: "" },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    loginAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    logoutAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

loginActivitySchema.index({ userId: 1, loginAt: -1 });

export default mongoose.model("LoginActivity", loginActivitySchema);
