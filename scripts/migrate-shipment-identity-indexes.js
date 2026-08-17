/**
 * Verifies courier-identity uniqueness on `orders`, and drops the plain indexes it
 * supersedes.
 *
 * The unique constraints are declared in Order.model.js under EXPLICIT names
 * (`shiprocket_orderId_unique`, `shiprocket_awbCode_unique`), so autoIndex builds
 * them on boot and uniqueness is live without running anything here.
 *
 * They had to be named explicitly. The plain indexes they replace already own the
 * auto-generated names `shiprocket.orderId_1` / `shiprocket.awbCode_1`, and MongoDB
 * refuses to redefine an index under an existing name — an auto-named unique version
 * fails with IndexKeySpecsConflict (code 86) on every boot, under both autoIndex and
 * syncIndexes, silently leaving the collection non-unique. That is precisely the
 * ambiguity H2-01 is about, so it must not depend on remembering a migration.
 *
 * WHY PARTIAL AND NOT SPARSE: both fields are declared `default: null`, so orders
 * without a shipment store an explicit null. `sparse` skips only ABSENT fields, so a
 * unique+sparse index would treat all those nulls as duplicates of each other. The
 * partial filter keys on `$type`, indexing only rows that carry a real identifier —
 * exactly the set that must be unique.
 *
 * This script therefore does three things:
 *   1. reports duplicate REAL identifiers — the one condition that needs a human,
 *      because it makes the unique index fail to build;
 *   2. confirms the unique indexes exist (creating them if autoIndex is off);
 *   3. drops the redundant plain indexes on the same keys.
 *
 * Safe to re-run. It never touches order documents — only indexes.
 *
 *   node scripts/migrate-shipment-identity-indexes.js            # apply
 *   node scripts/migrate-shipment-identity-indexes.js --check    # report only
 */
import "dotenv/config";
import mongoose from "mongoose";

const CHECK_ONLY = process.argv.includes("--check");

const TARGETS = [
  {
    field: "shiprocket.orderId",
    bsonType: "number",
    uniqueName: "shiprocket_orderId_unique",
    redundantName: "shiprocket.orderId_1",
  },
  {
    field: "shiprocket.awbCode",
    bsonType: "string",
    uniqueName: "shiprocket_awbCode_unique",
    redundantName: "shiprocket.awbCode_1",
  },
];

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
const orders = mongoose.connection.collection("orders");

let blocked = false;

console.log(`\nDatabase: ${mongoose.connection.name}`);
console.log(CHECK_ONLY ? "Mode: CHECK ONLY (no changes)\n" : "Mode: APPLY\n");

for (const target of TARGETS) {
  console.log(`── ${target.field}`);

  const withValue = await orders.countDocuments({ [target.field]: { $type: target.bsonType } });
  const nulls = await orders.countDocuments({ [target.field]: null });
  const missing = await orders.countDocuments({ [target.field]: { $exists: false } });
  console.log(`   real values: ${withValue} · null: ${nulls} · missing: ${missing}`);

  // 1. Duplicate REAL values are the only thing that can make this unsafe.
  const duplicates = await orders
    .aggregate([
      { $match: { [target.field]: { $type: target.bsonType } } },
      { $group: { _id: `$${target.field}`, count: { $sum: 1 }, orders: { $addToSet: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    blocked = true;
    console.log(`   BLOCKED — ${duplicates.length} duplicated value(s):`);
    for (const duplicate of duplicates.slice(0, 20)) {
      console.log(
        `     ${JSON.stringify(duplicate._id)} on orders ${duplicate.orders.map(String).join(", ")}`,
      );
    }
    console.log(
      "   Not auto-resolvable: decide which order legitimately owns the identifier",
    );
    console.log("   and clear it on the other. Nothing was changed for this field.");
    continue;
  }
  console.log("   no duplicate real values");

  const indexes = await orders.indexes();
  const unique = indexes.find((index) => index.name === target.uniqueName);
  const redundant = indexes.find((index) => index.name === target.redundantName);

  // 2. The unique index should already exist via autoIndex; create it if not.
  if (unique) {
    console.log(`   "${target.uniqueName}" present`);
  } else if (CHECK_ONLY) {
    console.log(`   WOULD create "${target.uniqueName}" (autoIndex has not built it)`);
  } else {
    await orders.createIndex(
      { [target.field]: 1 },
      {
        name: target.uniqueName,
        unique: true,
        partialFilterExpression: { [target.field]: { $type: target.bsonType } },
      },
    );
    console.log(`   created "${target.uniqueName}"`);
  }

  // 3. The plain index on the same key is now redundant.
  if (!redundant) {
    console.log(`   no redundant "${target.redundantName}" to remove`);
  } else if (CHECK_ONLY) {
    console.log(`   WOULD drop redundant plain index "${target.redundantName}"`);
  } else {
    await orders.dropIndex(target.redundantName);
    console.log(`   dropped redundant plain index "${target.redundantName}"`);
  }
}

const finalIndexes = (await orders.indexes())
  .filter((index) => index.name.toLowerCase().includes("shiprocket"))
  .map((index) => `${index.name}${index.unique ? " (UNIQUE)" : ""}`);
console.log(`\nShiprocket indexes now:\n  ${finalIndexes.join("\n  ")}`);

await mongoose.disconnect();

if (blocked) {
  console.log("\nOne or more fields were BLOCKED. Resolve the duplicates and re-run.");
  process.exit(1);
}
console.log(CHECK_ONLY ? "\nCheck complete." : "\nDone.");
