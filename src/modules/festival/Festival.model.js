import mongoose from "mongoose";

const FestivalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    startMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    startDay: {
      type: Number,
      required: true,
      min: 1,
      max: 31,
    },
    endMonth: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    endDay: {
      type: Number,
      required: true,
      min: 1,
      max: 31,
    },
    countdownFrom: {
      type: Number,
      default: 7,
      min: 0,
    },
    banner: {
      type: String,
      trim: true,
      default: "",
    },
    emoji: {
      type: String,
      trim: true,
      default: "",
    },
    gradient: {
      type: String,
      trim: true,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

FestivalSchema.index({ active: 1, name: 1 });

export default mongoose.model("Festival", FestivalSchema);
