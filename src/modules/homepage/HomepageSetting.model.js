import mongoose from "mongoose";

const homepageSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "homepage",
      unique: true,
      immutable: true,
    },
    bestsellerCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    backgroundColor: {
      type: String,
      default: "#ffffff",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model("HomepageSetting", homepageSettingSchema);
