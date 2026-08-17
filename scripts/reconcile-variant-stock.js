/**
 * Reports — and, with --fix, repairs — divergence between a product's total
 * stock and the sum of its per-variant stocks.
 *
 * The invariant `product.stock === Σ variants[].stock` (for variant-stocked
 * products) breaks when an order line that names no resolvable variant
 * decrements only the product total. The sale-side guards now refuse such
 * lines, but data corrupted before the guards must be reconciled by hand —
 * this script is that hand.
 *
 * Report mode (default) prints every product whose counters disagree, plus
 * every variant whose `attributes` are empty/blank (an unmatchable key — the
 * root of the "unresolvable variant" case).
 *
 * --fix applies only the UNAMBIGUOUS repairs:
 *   1. Backfills empty/blank variant attributes with { <axis>: <name> } so
 *      future cart/order keys resolve. Axis name defaults to "Size" (the only
 *      axis the storefront produces).
 *   2. For a product with EXACTLY ONE stock-tracked variant whose total is
 *      BELOW the variant's stock (sales skipped the variant), sets the
 *      variant's stock to the product total — the physical truth.
 *   Everything else (multi-variant deficits, totals above the sum) is
 *   reported for a human decision: the direction of truth is ambiguous.
 *
 * Safe to re-run — all repairs are idempotent.
 *
 *   node scripts/reconcile-variant-stock.js          # report only
 *   node scripts/reconcile-variant-stock.js --fix    # apply unambiguous repairs
 */
import "dotenv/config";
import mongoose from "mongoose";

const FIX = process.argv.includes("--fix");

const uri =
  process.env.mongo_url ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/E-commerce";

await mongoose.connect(uri);
// Product.model.js registers the collection explicitly as "products".
const collection = mongoose.connection.collection("products");

const tracked = (variants = []) => variants.filter((v) => typeof v.stock === "number");

const all = await collection
  .find({ "variants.0": { $exists: true } })
  .project({ name: 1, stock: 1, variants: 1 })
  .toArray();

let divergent = 0;
let unmatchable = 0;
let fixedStocks = 0;
let fixedAttributes = 0;

for (const product of all) {
  const trackedVariants = tracked(product.variants);
  if (trackedVariants.length === 0) continue; // legacy label-only sizes — total is authoritative

  const sum = trackedVariants.reduce((total, v) => total + (Number(v.stock) || 0), 0);
  const stock = Number(product.stock) || 0;
  const delta = stock - sum;

  // Unmatchable variants: empty attributes or a blank attribute name.
  const broken = (product.variants || []).filter((v) => {
    const keys =
      v.attributes && typeof v.attributes === "object" ? Object.keys(v.attributes) : [];
    return keys.length === 0 || keys.some((k) => !String(k).trim());
  });

  if (broken.length > 0) {
    unmatchable += broken.length;
    console.log(
      `\n[attributes] ${product._id} "${product.name}": ${broken.length} variant(s) with no matchable attributes:`,
      broken.map((v) => v.name).join(", "),
    );
    if (FIX) {
      for (const v of broken) {
        // eslint-disable-next-line no-await-in-loop
        await collection.updateOne(
          { _id: product._id, "variants._id": v._id },
          { $set: { "variants.$.attributes": { Size: String(v.name || "").trim() } } },
        );
        fixedAttributes += 1;
      }
      console.log(`  → backfilled attributes as { Size: <name> }`);
    }
  }

  if (delta === 0) continue;
  divergent += 1;

  console.log(
    `\n[stock] ${product._id} "${product.name}": total=${stock}, variant sum=${sum}, delta=${delta}`,
  );
  for (const v of trackedVariants) {
    console.log(`  - ${v.name}: ${v.stock}`);
  }

  if (delta < 0 && trackedVariants.length === 1) {
    // Sales skipped the single variant — total is physical truth.
    if (FIX) {
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne(
        { _id: product._id, "variants._id": trackedVariants[0]._id },
        { $set: { "variants.$.stock": stock } },
      );
      fixedStocks += 1;
      console.log(`  → set variant "${trackedVariants[0].name}" stock ${trackedVariants[0].stock} → ${stock}`);
    } else {
      console.log(`  → fixable: single variant, total is truth (run with --fix)`);
    }
  } else if (delta < 0) {
    console.log(
      `  → NOT auto-fixed: multiple variants — decide which one(s) absorbed the ${-delta} unit deficit and edit via the product form.`,
    );
  } else {
    console.log(
      `  → NOT auto-fixed: total exceeds the sum by ${delta} (product-level restock after a variant was deleted?). Assign it to a variant via the product form, or accept that the next variant save collapses the total to ${sum}.`,
    );
  }
}

console.log(
  `\nDone. ${all.length} variant-bearing product(s) scanned; ${divergent} with diverged counters; ${unmatchable} unmatchable variant(s).` +
    (FIX ? ` Fixed: ${fixedStocks} variant stock(s), ${fixedAttributes} attribute backfill(s).` : " (report only — run with --fix to repair the unambiguous cases)"),
);

await mongoose.disconnect();
