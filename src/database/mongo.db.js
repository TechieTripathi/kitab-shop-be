
import mongoose from "mongoose";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../../.env") });

const mongoUrl =
  process.env.mango_url ||
  process.env.mongo_url ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL;

const connectMongoDB = async () => {
  try {
    if (!mongoUrl) {
      throw new Error(
        "Mongo connection string missing. Set mango_url, MONGO_URI, MONGODB_URI, or MONGO_URL in .env."
      );
    }

    await mongoose.connect(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    });

    console.log("✅ MongoDB Connected");
  } catch (ex) {
    console.error("❌ MongoDB Connection Error:", ex.message);
    process.exit(1);
  }
};

export default connectMongoDB;
