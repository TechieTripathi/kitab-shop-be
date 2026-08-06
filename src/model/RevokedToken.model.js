import mongoose from "mongoose";

const revokedTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
      index: true,
    },
    tokenType: {
      type: String,
      enum: ["access", "refresh"],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    reason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

export default mongoose.model("RevokedToken", revokedTokenSchema);

