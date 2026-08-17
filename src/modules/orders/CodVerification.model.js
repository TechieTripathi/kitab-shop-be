import mongoose from "mongoose";

// One doc per OTP request. `expires` gives Mongo's TTL monitor a hard
// cleanup point (20 min) that covers both the OTP-entry window (checked in
// app code as 10 min from createdAt) and, once verified, the grace window
// PlaceOrder accepts a verified doc within — no separate expiry field needed.
const codVerificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserAuthenticationModel",
    required: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  // "sms" is a placeholder for when a paid SMS provider is wired up — every
  // send/verify path today only ever sets/expects "email".
  channel: {
    type: String,
    enum: ["email", "sms"],
    default: "email",
  },
  otpHash: {
    type: String,
    required: true,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 1200,
  },
});

export default mongoose.model("CodVerification", codVerificationSchema);
