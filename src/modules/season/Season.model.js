import mongoose from "mongoose";

const SeasonSchema = new mongoose.Schema(
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
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

SeasonSchema.index({ active: 1, name: 1 });

export default mongoose.model("Season", SeasonSchema);
