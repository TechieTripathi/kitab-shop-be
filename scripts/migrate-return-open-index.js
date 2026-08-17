/**
 * Replaces the all-time return uniqueness constraint with a one-OPEN-return one.
 *
 * OLD  order_1_product_1_user_1              unique, no filter
 * NEW  one_open_return_per_order_line        unique, partial on the open statuses
 *
 * The old index permitted exactly one return document per (order, product, user)
 * FOR ALL TIME. That is stricter than the lifecycle the model implements: `rejected`
 * is terminal with no reopen endpoint, so a QC rejection made in error permanently
 * barred the customer; and `quantity` is stored and validated per request, so
 * returning 1 of 5 units is intended — yet the first such return exhausted the line.
 *
 * The new constraint is declared in return.model.js under an EXPLICIT name, so
 * autoIndex builds it on boot and the correct behaviour is live without running
 * anything here. The name is explicit deliberately: an auto-named replacement would
 * be `order_1_product_1_user_1` too, and MongoDB refuses to redefine an index under
 * an existing name — it would fail with IndexKeySpecsConflict (code 86) on every
 * boot and silently leave the old, over-strict index in force.
 *
 * This script therefore:
 *   1. reports any line that already has MORE THAN ONE open return, which would
 *      make the new index fail to build — the only condition needing a human;
 *   2. confirms the new index exists (creating it if autoIndex is off);
 *   3. drops the old all-time unique index, which is what actually relaxes the
 *      constraint.
 *
 * Safe to re-run. It never touches return documents — only indexes. It will not
 * delete, merge or edit a record to make an index build succeed.
 *
 *   node scripts/migrate-return-open-index.js            # apply
 *   node scripts/migrate-return-open-index.js --check    # report only
 */
import "dotenv/config";
import mongoose from "mongoose";

const CHECK_ONLY = process.argv.includes("--check");

// Imported rather than duplicated, so the migration cannot drift from the schema —
// which is exactly what this script now has to detect and repair.
const { OPEN_RETURN_STATUSES: OPEN_STATUSES } = await import(
  "../src/modules/returns/return.model.js"
);
const NEW_INDEX = "one_open_return_per_order_line";
const OLD_INDEX = "order_1_product_1_user_1";

const uri =
  process.env.mango_url ||
  process.env.mongo_url ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL;

if (!uri) {
  console.error("No MongoDB connection string in the environment.");
  process.exit(1);
}

await mongoose.connect(uri);
const returns = mongoose.connection.collection("returnrequests");

console.log(`\nDatabase: ${mongoose.connection.name}`);
console.log(CHECK_ONLY ? "Mode: CHECK ONLY (no changes)\n" : "Mode: APPLY\n");

const total = await returns.countDocuments();
const byStatus = await returns
  .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  .toArray();
console.log(`returns: ${total}`);
console.log(`  ${byStatus.map((row) => `${row._id}: ${row.count}`).join(" · ") || "none"}`);

// 1. VALIDATE FIRST. More than one OPEN return on a line breaks the new index.
const conflicts = await returns
  .aggregate([
    { $match: { status: { $in: OPEN_STATUSES } } },
    {
      $group: {
        _id: { order: "$order", product: "$product", user: "$user" },
        count: { $sum: 1 },
        returns: { $addToSet: "$returnNumber" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ])
  .toArray();

if (conflicts.length > 0) {
  console.log(`\nBLOCKED — ${conflicts.length} order line(s) already have several OPEN returns:`);
  for (const conflict of conflicts.slice(0, 20)) {
    console.log(
      `  order ${conflict._id.order} · product ${conflict._id.product} → ${conflict.returns.join(", ")}`,
    );
  }
  console.log(
    "\nNot auto-resolvable: resolve or reject the duplicates through the admin flow so",
  );
  console.log("only one remains open per line, then re-run. Nothing was changed.");
  await mongoose.disconnect();
  process.exit(1);
}
console.log("\nno line has more than one open return — the new index can build");

// Informational: lines that will now legitimately hold several returns.
const multiples = await returns
  .aggregate([
    {
      $group: {
        _id: { order: "$order", product: "$product", user: "$user" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ])
  .toArray();
console.log(
  `lines with more than one return in total: ${multiples.length}` +
    (multiples.length ? " (legal under the new constraint)" : ""),
);

const indexes = await returns.indexes();
const existingNew = indexes.find((index) => index.name === NEW_INDEX);
const existingOld = indexes.find((index) => index.name === OLD_INDEX);

// 2. The new index should already exist via autoIndex; create it if not — and
//    REBUILD it when its partial filter no longer matches OPEN_RETURN_STATUSES.
//
//    That drift is silent and dangerous: adding a status to the open set (as the
//    replacement lifecycle does) changes the index SPEC under the same name, and
//    MongoDB refuses to redefine an index under an existing name. autoIndex and
//    syncIndexes both fail with IndexKeySpecsConflict and leave the OLD filter in
//    place, so the new open status is simply not covered by the uniqueness
//    constraint and a second return could be raised against an occupied line.
const expectedFilter = JSON.stringify({ status: { $in: OPEN_STATUSES } });
const actualFilter = JSON.stringify(existingNew?.partialFilterExpression);
const filterIsStale = Boolean(existingNew) && actualFilter !== expectedFilter;

if (filterIsStale) {
  console.log(`\n"${NEW_INDEX}" exists but its filter is STALE`);
  console.log(`   expected: ${expectedFilter}`);
  console.log(`   actual:   ${actualFilter}`);
  if (CHECK_ONLY) {
    console.log("   WOULD drop and recreate it with the current open-status set");
  } else {
    await returns.dropIndex(NEW_INDEX);
    await returns.createIndex(
      { order: 1, product: 1, user: 1 },
      {
        name: NEW_INDEX,
        unique: true,
        partialFilterExpression: { status: { $in: OPEN_STATUSES } },
      },
    );
    console.log("   rebuilt with the current open-status set");
  }
} else if (existingNew) {
  console.log(`\n"${NEW_INDEX}" present and its filter is current`);
} else if (CHECK_ONLY) {
  console.log(`\nWOULD create "${NEW_INDEX}"`);
} else {
  await returns.createIndex(
    { order: 1, product: 1, user: 1 },
    {
      name: NEW_INDEX,
      unique: true,
      partialFilterExpression: { status: { $in: OPEN_STATUSES } },
    },
  );
  console.log(`\ncreated "${NEW_INDEX}"`);
}

// 3. Dropping the old index is what actually relaxes the constraint.
if (!existingOld) {
  console.log(`no old "${OLD_INDEX}" to remove`);
} else if (CHECK_ONLY) {
  console.log(`WOULD drop the all-time unique index "${OLD_INDEX}"`);
} else {
  await returns.dropIndex(OLD_INDEX);
  console.log(`dropped the all-time unique index "${OLD_INDEX}"`);
}

const finalIndexes = (await returns.indexes()).map(
  (index) =>
    `${index.name}${index.unique ? " (UNIQUE)" : ""}${index.partialFilterExpression ? " (partial)" : ""}`,
);
console.log(`\nReturn indexes now:\n  ${finalIndexes.join("\n  ")}`);

await mongoose.disconnect();
console.log(CHECK_ONLY ? "\nCheck complete." : "\nDone.");
