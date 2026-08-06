import mongoose from "mongoose";

const themeSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "editable_styles",
      unique: true,
      immutable: true,
    },
    styles: {
      type: Object,
      default: {},
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ThemeSetting", themeSettingSchema);
