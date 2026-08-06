import mongoose from "mongoose";

const cmsBlockSchema = new mongoose.Schema(
  {
    pageType: {
      type: String,
      enum: ["homepage", "category"],
      required: true,
      index: true,
    },
    pageKey: {
      type: String,
      default: "homepage",
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["hero", "banner", "rich_text", "product_row", "category_row", "custom"],
      default: "custom",
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    position: {
      type: Number,
      default: 0,
      index: true,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
  },
  { timestamps: true },
);

cmsBlockSchema.index({ pageType: 1, pageKey: 1, position: 1 });

export default mongoose.model("CmsBlock", cmsBlockSchema);

