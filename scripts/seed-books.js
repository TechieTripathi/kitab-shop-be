/**
 * Seeds the Kitab Shop book catalogue into a LOCAL database:
 *   - 8 genre categories and 50 books (from scripts/data/, adapted from the
 *     old/book-ecommerce reference project)
 *   - Format variants per book: Paperback + Hardcover (buyable) and E-book
 *     (seeded `active: false, stock: 0` — digital fulfilment does not exist,
 *     and an inactive variant can never reach Shiprocket's physical-shipping
 *     path; see order-shipping-package.js before ever enabling it)
 *   - superAdmin + customer accounts, coupons, and a homepage banner
 *
 * Cover images are downloaded from Unsplash once per unique photo (books
 * share photos in the reference data) into uploads/products/ and served from
 * /uploads like every other asset. If a download fails (offline), the book
 * gets a locally generated placeholder instead — the seed never hotlinks.
 *
 * Refuses to run against anything that is not a loopback connection string.
 * Safe to re-run: everything upserts by natural key, images are cached.
 *
 * Usage:
 *   npm run db:seed:books      # with mongo_url already in .env
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mongoose from "mongoose";
import sharp from "sharp";

import Category from "../src/modules/categories/Category.model.js";
import Product from "../src/modules/products/Product.model.js";
import CouponModel from "../src/modules/coupons/coupon.model.js";
import Banner from "../src/modules/banner/Banner.model.js";
import User from "../src/model/User.model.js";
import { CreateharhPassword } from "../src/passwordhash/password.js";
import { normalizeRoles } from "../src/config/admin-permissions.config.js";
import { uploadsRoot, resolveFolder, toPublicPath } from "../src/config/storage.config.js";

import { products as referenceBooks } from "./data/reference-books.js";
import { categories as referenceGenres } from "./data/reference-genres.js";

const url = process.env.mongo_url || process.env.mango_url || process.env.MONGO_URL || "";

const isLocal = /(?:\/\/|@)(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\b/.test(url);
if (!url || !isLocal) {
  console.error("Refusing to run: mongo_url must point at 127.0.0.1 or localhost.");
  console.error(`Received: ${url ? url.replace(/\/\/[^@]*@/, "//***:***@") : "(empty)"}`);
  process.exit(1);
}

const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@kitab.local").toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "AdminKitab12345";
const customerEmail = (process.env.SEED_CUSTOMER_EMAIL || "customer@kitab.local").toLowerCase();
const customerPassword = process.env.SEED_CUSTOMER_PASSWORD || "CustomerKitab12345";

// ── image helpers ───────────────────────────────────────────────────────────

const fileExists = async (path) => {
  const info = await stat(path).catch(() => null);
  return info?.size > 0;
};

/** Local fallback cover so the seed works fully offline. */
const buildPlaceholder = async () => {
  const folder = resolveFolder("static");
  const target = join(uploadsRoot, folder, "book-placeholder.webp");
  const publicPath = toPublicPath("static", "book-placeholder.webp");
  if (await fileExists(target)) return publicPath;

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
       <rect width="600" height="600" fill="#F5F1EA"/>
       <rect x="185" y="140" width="230" height="320" rx="10" fill="#FFFFFF"
             stroke="#6B4F3A" stroke-width="8"/>
       <path d="M215 200 h170 M215 240 h170 M215 280 h110" stroke="#D4A373"
             stroke-width="10" stroke-linecap="round"/>
     </svg>`,
  );
  await mkdir(join(uploadsRoot, folder), { recursive: true });
  await writeFile(target, await sharp(svg).webp({ quality: 82 }).toBuffer());
  console.log("  + book-placeholder.webp");
  return publicPath;
};

/**
 * Download one Unsplash photo into uploads/<folder>/ with a stable name so
 * re-runs are no-ops. Returns the public /uploads path, or null on failure.
 */
const downloadImage = async ({ sourceUrl, folder, fileName, width, height }) => {
  const resolved = resolveFolder(folder);
  const target = join(uploadsRoot, resolved, fileName);
  const publicPath = toPublicPath(folder, fileName);
  if (await fileExists(target)) return publicPath;

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const output = await sharp(buffer)
      .resize(width, height, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    await mkdir(join(uploadsRoot, resolved), { recursive: true });
    await writeFile(target, output);
    console.log(`  + ${fileName} (${Math.round(output.length / 1024)} kB)`);
    return publicPath;
  } catch (error) {
    console.warn(`  ! ${fileName}: ${error.message} — using placeholder`);
    return null;
  }
};

const unsplashPhotoId = (imageUrl) => {
  const match = String(imageUrl || "").match(/images\.unsplash\.com\/([^?]+)/);
  return match ? match[1] : null;
};

// ── content helpers ─────────────────────────────────────────────────────────

const slugify = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");

// The storefront splits producthightlight on "," — commas inside a single
// highlight would shatter it into fragments, so they become "·" first.
const toHighlightString = (highlights = []) =>
  highlights.map((h) => String(h).replace(/,\s*/g, " · ")).join(", ");

const parseEditionYear = () => null; // reference data has editions, not years

/**
 * Reference variants are the admin-form option-group shape
 * ({name: "Format", options: [...]}) — expand to the flat stored shape with
 * an `attributes: {Format: <name>}` Map, matching what variantKeyFrom() and
 * the cart derive ("Format:Paperback").
 */
const buildVariants = (book) => {
  const group = (book.variants || [])[0];
  const formats = group?.options?.length
    ? group.options.map((option) => option.name)
    : ["Paperback", "Hardcover", "E-book"];
  const baseStock = Number.isFinite(Number(book.stock)) ? Number(book.stock) : 25;

  return formats.map((format) => {
    const isEbook = /e-?book/i.test(format);
    const isHardcover = /hardcover/i.test(format);
    // Hardcover costs more, e-books less; each keeps price <= its own mrp.
    const factor = isHardcover ? 1.5 : isEbook ? 0.6 : 1;
    return {
      name: format,
      attributes: { Format: format },
      sku: `${book.isbn}-${format.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}`,
      price: Math.round(book.price * factor),
      mrp: Math.round(book.mrp * factor),
      stock: isEbook ? 0 : isHardcover ? Math.ceil(baseStock / 2) : baseStock,
      reservedStock: 0,
      active: !isEbook,
    };
  });
};

const sumActiveStock = (variants) =>
  variants.reduce((total, v) => total + (v.active ? v.stock : 0), 0);

// ── seed ────────────────────────────────────────────────────────────────────

await mongoose.connect(url);
console.log(`Seeding book catalogue into ${url.replace(/\/\/[^@]*@/, "//***@")}\n`);

const placeholder = await buildPlaceholder();

// Users
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

// Genres → flat Category docs (name/tagline/themecolor/image all required)
console.log("Genres:");
const categoryIdBySlug = new Map();
for (const genre of referenceGenres) {
  const photoId = unsplashPhotoId(genre.image);
  const image =
    (photoId &&
      (await downloadImage({
        sourceUrl: genre.image,
        folder: "categories",
        fileName: `genre-${genre.id}.webp`,
        width: 400,
        height: 400,
      }))) ||
    placeholder;

  const doc = await Category.findOneAndUpdate(
    { name: genre.name },
    {
      name: genre.name,
      tagline: genre.tagline,
      themecolor: genre.color,
      image,
      bestseller: ["fiction", "non-fiction"].includes(genre.id),
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  categoryIdBySlug.set(genre.id, doc._id);
}

// Books
console.log("\nBooks:");
let seeded = 0;
for (const book of referenceBooks) {
  const category_id = categoryIdBySlug.get(book.category);
  if (!category_id) {
    console.warn(`  ! skipped "${book.name}" — unknown genre "${book.category}"`);
    continue;
  }

  const photoId = unsplashPhotoId(book.image);
  const image =
    (photoId &&
      (await downloadImage({
        sourceUrl: book.image,
        folder: "products",
        // Cache per photo, not per book — the reference data reuses photos.
        fileName: `book-${photoId.replace(/[^\w-]/g, "")}.webp`,
        width: 500,
        height: 500,
      }))) ||
    placeholder;

  const variants = buildVariants(book);
  const slug = slugify(book.name);

  await Product.findOneAndUpdate(
    { name: book.name },
    {
      name: book.name,
      description: book.description,
      producthightlight: toHighlightString(book.highlights),
      price: book.price,
      mrp: book.mrp,
      category_id,
      brand: book.publisher,
      author: book.author,
      publisher: book.publisher,
      isbn: book.isbn,
      language: book.language || "English",
      pages: Number(book.pages) || 0,
      edition: book.edition || "",
      publicationYear: parseEditionYear(book),
      variants,
      stock: sumActiveStock(variants),
      bestseller: book.badge === "Bestseller",
      image,
      public_id: image,
      // A single paperback in a padded mailer — Shiprocket package fallbacks.
      weight: 0.35,
      length: 22,
      breadth: 14,
      height: 3,
      returnPolicy: { kind: "return", windowDays: 7 },
      metaTitle: `Buy ${book.name} by ${book.author} Online`.slice(0, 160),
      metaDescription: String(book.description).slice(0, 320),
      metaKeywords: [book.author, book.publisher, book.category, "books"].filter(Boolean),
      slug,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  seeded += 1;
}

// Coupons (KITAB10 etc. from the reference project)
const now = new Date();
const nextYear = new Date(now);
nextYear.setFullYear(now.getFullYear() + 1);
const coupons = [
  { couponId: "KITAB10", discountType: "percentage", discountValue: 10, minPurchaseAmount: 0 },
  { couponId: "SAVE150", discountType: "fixed", discountValue: 150, minPurchaseAmount: 999 },
  { couponId: "BOOK20", discountType: "percentage", discountValue: 20, minPurchaseAmount: 1499 },
  { couponId: "WELCOME50", discountType: "fixed", discountValue: 50, minPurchaseAmount: 299 },
];
for (const coupon of coupons) {
  try {
    await CouponModel.findOneAndUpdate(
      { couponId: coupon.couponId },
      {
        ...coupon,
        targetType: "all",
        isActive: true,
        startDate: now,
        expireDate: nextYear,
        maxLimit: 5,
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  } catch (error) {
    console.warn(`coupon ${coupon.couponId} skipped: ${error.message}`);
  }
}

// Homepage hero banner — generated locally so the seed has no image dependency.
const bannerFolder = resolveFolder("banners");
const bannerFile = "book-hero.webp";
const bannerTarget = join(uploadsRoot, bannerFolder, bannerFile);
const bannerPublic = toPublicPath("banners", bannerFile);
if (!(await fileExists(bannerTarget))) {
  const heroSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600">
       <defs>
         <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="#4A3728"/>
           <stop offset="1" stop-color="#6B4F3A"/>
         </linearGradient>
       </defs>
       <rect width="1600" height="600" fill="url(#bg)"/>
       ${[80, 190, 300, 410, 520, 1180, 1290, 1400].map((x, i) => {
         const h = 300 + ((i * 53) % 120);
         return `<rect x="${x}" y="${560 - h}" width="86" height="${h}" rx="6"
                  fill="${i % 2 ? "#D4A373" : "#8B6F56"}" opacity="0.35"/>`;
       }).join("")}
     </svg>`,
  );
  await mkdir(join(uploadsRoot, bannerFolder), { recursive: true });
  await writeFile(bannerTarget, await sharp(heroSvg).webp({ quality: 85 }).toBuffer());
}
await Banner.findOneAndUpdate(
  { title: "Discover Your Next Great Read" },
  {
    bg: bannerPublic,
    public_id: bannerPublic,
    title: "Discover Your Next Great Read",
    subtitle: "Curated fiction, timeless classics & fresh releases — delivered to your door",
    cta: "Shop Now",
    to: "/products",
    isActive: true,
    order: 1,
  },
  { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
);

console.log(`\nadmin      : ${adminEmail} / ${adminPassword}`);
console.log(`customer   : ${customerEmail} / ${customerPassword}`);
console.log(`genres     : ${await Category.countDocuments()}`);
console.log(`books      : ${seeded} seeded (${await Product.countDocuments()} in collection)`);
console.log(`coupons    : ${await CouponModel.countDocuments()}`);
console.log(`banners    : ${await Banner.countDocuments()}`);

await mongoose.disconnect();
