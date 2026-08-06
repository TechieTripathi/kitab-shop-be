import mongoose from "mongoose";

const dailyTrafficSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // Format: YYYY-MM-DD
    totalUsers: { type: Number, default: 0 },
    newUsers: { type: Number, default: 0 },
    returningUsers: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const DailyTraffic = mongoose.model("DailyTraffic", dailyTrafficSchema);
export default DailyTraffic;
