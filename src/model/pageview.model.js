import mongoose from "mongoose";

const pageViewSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const PageViewModel = mongoose.model("PageView", pageViewSchema);
export default PageViewModel;
