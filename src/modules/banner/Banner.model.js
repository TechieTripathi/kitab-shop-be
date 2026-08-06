import mongoose from "mongoose";

const BannerSchema = new mongoose.Schema(
  {
    bg: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
    },
    title: {
      type: String,
      default: "",
    },
    titleColor: String,
    subtitle: String,
    subtitleColor: String,
    cta: String,
    ctaBg: String,
    ctaText: String,
    styles: {
      title: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 36, min: 1, max: 96 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "bold" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#ffffff" },
      },
      subtitle: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 16, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#f3f4f6" },
      },
      cta: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 16, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "bold" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#000000" },
      },
    },
    overlayOpacity: Number,
    alignment: String,
    to: {
      type: String,
      default: "/",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

BannerSchema.index({ isActive: 1, order: 1, createdAt: -1 });
BannerSchema.index({ order: 1, createdAt: -1 });

export default mongoose.model("Banner", BannerSchema);
