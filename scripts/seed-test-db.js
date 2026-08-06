/**
 * Seeds a minimal catalogue plus an admin account into a LOCAL test database.
 *
 * Intended for integration tests and for exercising the admin screens without
 * touching real data. Refuses to run against anything that is not a loopback
 * connection string, so it cannot be pointed at Atlas by accident.
 *
 * Usage:
 *   mango_url="mongodb://127.0.0.1:27017/kitab-test" node scripts/seed-test-db.js
 *   npm run db:seed:test        # with mango_url already exported
 *
 * Optional overrides:
 *   TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD
 */
import mongoose from "mongoose";

import Category from "../src/modules/categories/Category.model.js";
import Product from "../src/modules/products/Product.model.js";
import CouponModel from "../src/modules/coupons/coupon.model.js";
import User from "../src/model/User.model.js";
import { CreateharhPassword } from "../src/passwordhash/password.js";
import { normalizeRoles } from "../src/config/admin-permissions.config.js";

const url = process.env.mango_url || process.env.MONGO_URL || "";

// Loopback only. A hostname check is the one guard that reliably separates a
// scratch database from a managed cluster.
const isLocal = /(?:\/\/|@)(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\b/.test(url);

if (!url || !isLocal) {
  console.error("Refusing to run: mango_url must point at 127.0.0.1 or localhost.");
  console.error(`Received: ${url ? url.replace(/\/\/[^@]*@/, "//***:***@") : "(empty)"}`);
  process.exit(1);
}

const adminEmail = (process.env.TEST_ADMIN_EMAIL || "admin@test.local").toLowerCase();
const adminPassword = process.env.TEST_ADMIN_PASSWORD || "AdminTest12345";
const customerEmail = (process.env.TEST_CUSTOMER_EMAIL || "customer@test.local").toLowerCase();
const customerPassword = process.env.TEST_CUSTOMER_PASSWORD || "CustomerTest12345";

const PLACEHOLDER_IMAGE = "/uploads/static/placeholder.webp";

await mongoose.connect(url);

const roles = normalizeRoles({ roles: ["superAdmin"] });
await User.findOneAndUpdate(
  { email: adminEmail },
  {
    email: adminEmail,
    password: await CreateharhPassword(adminPassword),
    roles,
    isActive: true,
    isBlocked: false,
    isVerified: true,
  },
  { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
);

// A non-admin account, needed to exercise cart and checkout: admin roles are
// blocked from purchasing.
await User.findOneAndUpdate(
  { email: customerEmail },
  {
    email: customerEmail,
    password: await CreateharhPassword(customerPassword),
    roles: ["user"],
    isActive: true,
    isBlocked: false,
    isVerified: true,
  },
  { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
);

const category = await Category.findOneAndUpdate(
  { name: "Gemstones" },
  {
    name: "Gemstones",
    tagline: "Certified natural stones",
    themecolor: "#7C3AED",
    image: PLACEHOLDER_IMAGE,
    bestseller: true,
  },
  { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
);

// Deliberately mixed stock levels so the admin inventory screen renders its
// in-stock, low-stock and out-of-stock branches.
const products = [
  { name: "Red Coral 7ct", price: 3500, mrp: 4200, stock: 12 },
  { name: "Blue Sapphire 5ct", price: 9500, mrp: 11000, stock: 3 },
  { name: "Yellow Sapphire 6ct", price: 7800, mrp: 8900, stock: 0 },
];

for (const item of products) {
  await Product.findOneAndUpdate(
    { name: item.name },
    {
      ...item,
      brand: "AstroWala",
      description: `${item.name}, lab certified and energised before dispatch.`,
      producthightlight: "100% natural, certified",
      category_id: category._id,
      image: PLACEHOLDER_IMAGE,
      metaTitle: `Buy ${item.name} Online`,
      metaDescription: `Certified ${item.name} with lab report.`,
      metaKeywords: ["gemstone", item.name.split(" ")[0].toLowerCase()],
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

try {
  await CouponModel.findOneAndUpdate(
    { couponId: "TESTDIWALI" },
    {
      couponId: "TESTDIWALI",
      discountType: "percentage",
      discountValue: 10,
      isActive: true,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
} catch (error) {
  console.warn(`coupon seed skipped: ${error.message}`);
}

console.log(`admin      : ${adminEmail} / ${adminPassword}`);
console.log(`customer   : ${customerEmail} / ${customerPassword}`);
console.log(`categories : ${await Category.countDocuments()}`);
console.log(`products   : ${await Product.countDocuments()}`);
console.log(`coupons    : ${await CouponModel.countDocuments()}`);

await mongoose.disconnect();
