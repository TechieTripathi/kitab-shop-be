/**
 * One-off cleanup: `role` was removed from UserSchema (2026-08-06) in favor of
 * `roles` as the sole source of truth. Mongo does not enforce the schema, so
 * existing documents still carry the old `role` key until this runs.
 *
 * Usage:
 *   node scripts/drop-legacy-user-role-field.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const mongoUrl =
  process.env.mango_url ||
  process.env.mongo_url ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL;

if (!mongoUrl) {
  console.error("Mongo connection string missing. Set mango_url, mongo_url, MONGO_URI, MONGODB_URI, or MONGO_URL in .env.");
  process.exit(1);
}

try {
  await mongoose.connect(mongoUrl);
  const result = await mongoose.connection.collection("users").updateMany(
    { role: { $exists: true } },
    { $unset: { role: "" } },
  );
  console.log(`Removed legacy 'role' field from ${result.modifiedCount} user document(s).`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
