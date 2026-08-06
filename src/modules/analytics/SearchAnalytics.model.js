import mongoose from "mongoose";

const searchAnalyticsSchema = new mongoose.Schema(
  {
    query: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    normalizedQuery: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    resultCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    clickedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: ["search_page", "autocomplete", "suggestion_click"],
      default: "search_page",
      index: true,
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

searchAnalyticsSchema.index({ createdAt: -1 });
searchAnalyticsSchema.index({ normalizedQuery: 1, createdAt: -1 });

export default mongoose.model("SearchAnalytics", searchAnalyticsSchema);

