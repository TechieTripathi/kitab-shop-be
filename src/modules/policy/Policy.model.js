import mongoose from "mongoose";

const PolicySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    heading: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    styles: {
      title: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 12, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#374151" },
      },
      heading: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 24, min: 1, max: 96 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "bold" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#111827" },
      },
      body: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 14, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#4B5563" },
      },
    },
    position: {
      type: Number,
      default: 0,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
    },
    lastEditedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
    },
  },
  { timestamps: true },
);

export default mongoose.model("Policy", PolicySchema);
