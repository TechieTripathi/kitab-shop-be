import mongoose from "mongoose";

const EmailVerification = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
    },

    token: {
      type: String,
      required: true,
    },

    otpHash: {
      type: String,
      required: true,
    },

    isUsed: {
      type: Boolean,
      default: false,
    },

    email: {
      type: String,
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      expires: 3600,
    },
  },

  {
    timestamps: true,
  },
);

export default mongoose.model("EmailVerification", EmailVerification);
