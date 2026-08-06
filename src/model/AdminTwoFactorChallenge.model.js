import mongoose from "mongoose";

const adminTwoFactorChallengeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

export default mongoose.model("AdminTwoFactorChallenge", adminTwoFactorChallengeSchema);

