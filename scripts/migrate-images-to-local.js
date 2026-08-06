/**
 * Move every Cloudinary-hosted image referenced by this database onto local
 * disk under uploads/<type>/, then rewrite the stored URLs to the relative
 * path the API serves them at.
 *
 *   node scripts/migrate-images-to-local.js --dry-run
 *   node scripts/migrate-images-to-local.js
 *   node scripts/migrate-images-to-local.js --uri "mongodb://..."
 *
 * Safe to re-run: files that already exist are not downloaded again, and
 * documents already holding a /uploads path are skipped. Cloudinary URLs
 * belonging to other applications sharing this database (the shadow-chat
 * folder) are deliberately left untouched — see SKIP_FOLDERS.
 */
import "dotenv/config";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import mongoose from "mongoose";
import {
  resolveStoragePath,
  toPublicPath,
  uploadsPublicPath,
  uploadsRoot,
} from "../src/config/storage.config.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const uriFlag = args.indexOf("--uri");
const mongoUri =
  (uriFlag !== -1 && args[uriFlag + 1]) || process.env.mango_url;

if (!mongoUri) {
  console.error("No Mongo URI. Set mango_url in .env or pass --uri.");
  process.exit(1);
}

// Cloudinary folders owned by other apps on this shared database.
const SKIP_FOLDERS = new Set(["shadow-chat", "shadow-chat/reels"]);

// Every field in this database that holds an image URL. `array` marks a path
// whose segment before it is an array of subdocuments. `publicIdField` is the
// sibling field that stored the Cloudinary public_id and now stores the same
// relative path.
const FIELD_SPECS = [
  { collection: "products", field: "image", publicIdField: "public_id" },
  { collection: "categories", field: "image", publicIdField: "public_id" },
  { collection: "banners", field: "bg", publicIdField: "public_id" },
  { collection: "userprofiles", field: "avatar", publicIdField: "avatarPublicId" },
  {
    collection: "reviews",
    arrayField: "images",
    field: "url",
    publicIdField: "public_id",
  },
  // Historical snapshots. Rewritten so past orders and returns keep showing a
  // real image instead of falling back to a placeholder.
  { collection: "orders", arrayField: "items", field: "image" },
  { collection: "returnrequests", field: "productSnapshot.image" },
];

const CLOUDINARY_URL = /^https?:\/\/res\.cloudinary\.com\//i;

/** astro-products/red-coral-123.webp from a full delivery URL. */
const toCloudinaryRelative = (url) => {
  const match = String(url).match(
    /\/image\/upload\/(?:[a-z]{1,3}_[^/]+\/)*(?:v\d+\/)?(.+)$/i,
  );
  return match ? match[1] : null;
};

const parseUrl = (url) => {
  const relative = toCloudinaryRelative(url);
  if (!relative) return null;

  const slash = relative.lastIndexOf("/");
  const cloudFolder = slash === -1 ? "" : relative.slice(0, slash);
  const fileName = relative.slice(slash + 1);

  if (SKIP_FOLDERS.has(cloudFolder)) return null;

  return { cloudFolder, fileName, publicPath: toPublicPath(cloudFolder, fileName) };
};

const getPath = (doc, path) =>
  path.split(".").reduce((value, key) => (value == null ? value : value[key]), doc);

const downloads = new Map(); // publicPath -> "downloaded" | "cached" | "failed"

const downloadOnce = async (url, publicPath) => {
  if (downloads.has(publicPath)) return downloads.get(publicPath);

  const absolutePath = resolveStoragePath(publicPath);
  if (!absolutePath) {
    downloads.set(publicPath, "failed");
    console.error(`  ! refused unsafe path ${publicPath}`);
    return "failed";
  }

  const existing = await stat(absolutePath).catch(() => null);
  if (existing?.size > 0) {
    downloads.set(publicPath, "cached");
    return "cached";
  }

  if (dryRun) {
    downloads.set(publicPath, "downloaded");
    return "downloaded";
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error("empty body");

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    downloads.set(publicPath, "downloaded");
    return "downloaded";
  } catch (error) {
    downloads.set(publicPath, "failed");
    console.error(`  ! ${url}\n    ${error.message}`);
    return "failed";
  }
};

await mongoose.connect(mongoUri);

const summary = [];
let rewritten = 0;
let skippedForeign = 0;
let failed = 0;

try {
  const db = mongoose.connection.db;

  for (const spec of FIELD_SPECS) {
    const collection = db.collection(spec.collection);
    const fieldLabel = spec.arrayField
      ? `${spec.arrayField}[].${spec.field}`
      : spec.field;

    let touchedDocs = 0;
    let touchedRefs = 0;

    for await (const doc of collection.find({})) {
      // (value, apply) pairs so a document is written once, not per field.
      const edits = [];

      const collect = (url, assign) => {
        if (typeof url !== "string" || !CLOUDINARY_URL.test(url)) return;

        const parsed = parseUrl(url);
        if (!parsed) {
          skippedForeign += 1;
          return;
        }

        edits.push({ url, ...parsed, assign });
      };

      if (spec.arrayField) {
        const items = doc[spec.arrayField];
        if (!Array.isArray(items)) continue;

        items.forEach((item, index) => {
          collect(getPath(item, spec.field), (publicPath, update) => {
            update[`${spec.arrayField}.${index}.${spec.field}`] = publicPath;
            if (spec.publicIdField) {
              update[`${spec.arrayField}.${index}.${spec.publicIdField}`] =
                publicPath;
            }
          });
        });
      } else {
        collect(getPath(doc, spec.field), (publicPath, update) => {
          update[spec.field] = publicPath;
          if (spec.publicIdField) update[spec.publicIdField] = publicPath;
        });
      }

      if (edits.length === 0) continue;

      const update = {};
      let usable = 0;

      for (const edit of edits) {
        const result = await downloadOnce(edit.url, edit.publicPath);
        if (result === "failed") {
          failed += 1;
          continue;
        }

        edit.assign(edit.publicPath, update);
        usable += 1;
      }

      if (usable === 0) continue;

      if (!dryRun) {
        await collection.updateOne({ _id: doc._id }, { $set: update });
      }

      touchedDocs += 1;
      touchedRefs += usable;
      rewritten += usable;
    }

    summary.push({
      target: `${spec.collection}.${fieldLabel}`,
      docs: touchedDocs,
      refs: touchedRefs,
    });
  }
} finally {
  await mongoose.disconnect();
}

const counts = [...downloads.values()].reduce(
  (acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }),
  {},
);

console.log(`\n${dryRun ? "DRY RUN — nothing written" : "Migration complete"}`);
console.log(`uploads root : ${uploadsRoot}`);
console.log(`served at    : ${uploadsPublicPath}`);
console.log(`\nfiles        : ${counts.downloaded || 0} downloaded, ${
  counts.cached || 0
} already present, ${counts.failed || 0} failed`);
console.log(`references   : ${rewritten} rewritten, ${failed} left on Cloudinary`);
// Collections owned by the other app (chats, status, users.faceProfile) are not
// in FIELD_SPECS at all, so they are never read. This counts only foreign URLs
// found inside a storefront field.
console.log(`foreign urls : ${skippedForeign} left alone (${[...SKIP_FOLDERS].join(
  ", ",
)})`);

console.log("\nby field:");
for (const row of summary) {
  console.log(`  ${row.refs.toString().padStart(4)} refs / ${row.docs
    .toString()
    .padStart(4)} docs  ${row.target}`);
}

console.log("\nlocal folders in use:");
for (const folder of new Set(
  [...downloads.keys()].map((p) => p.split("/")[2]),
)) {
  console.log(`  ${uploadsPublicPath}/${folder}/`);
}

if (failed > 0) process.exitCode = 1;
