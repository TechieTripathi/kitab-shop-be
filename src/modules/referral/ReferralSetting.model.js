import mongoose from "mongoose";

const referralSettingSchema = new mongoose.Schema(
  {
    signupDiscountType: {
      type: String,
      enum: ['fixed', 'percentage'],
      default: 'fixed'
    },
    signupDiscountAmount: {
      type: Number,
      required: true,
      default: 150,
      min: 0,
    },
    referrerRewardAmount: {
      type: Number,
      required: true,
      default: 100,
      min: 0,
    },
    singletonId: {
      type: String,
      default: "default",
      unique: true,
      index: true,
    }
  },
  {
    timestamps: true,
  }
);

// We use singletonId to ensure only one document exists.
referralSettingSchema.statics.getSettings = async function() {
  let settings = await this.findOne({ singletonId: "default" });
  if (!settings) {
    settings = await this.create({ singletonId: "default" });
  }
  return settings;
};

export default mongoose.model("ReferralSetting", referralSettingSchema);
