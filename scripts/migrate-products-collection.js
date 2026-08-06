import "dotenv/config";
import mongoose from "mongoose";

const LEGACY_COLLECTION = "productmodels";
const PRODUCT_COLLECTION = "products";

await mongoose.connect(process.env.mango_url);

try {
  const db = mongoose.connection.db;
  const collectionNames = new Set(
    (await db.listCollections().toArray()).map((collection) => collection.name),
  );

  if (!collectionNames.has(LEGACY_COLLECTION)) {
    console.log("No legacy productmodels collection found. Nothing to migrate.");
    process.exitCode = 0;
  } else {
    const products = db.collection(PRODUCT_COLLECTION);
    const legacyProducts = db.collection(LEGACY_COLLECTION);
    const legacyDocuments = await legacyProducts.find({}).toArray();
    const legacyIds = legacyDocuments.map((product) => product._id);
    const existingIds = new Set(
      (
        await products
          .find({ _id: { $in: legacyIds } }, { projection: { _id: 1 } })
          .toArray()
      ).map((product) => String(product._id)),
    );
    const missingProducts = legacyDocuments
      .filter((product) => !existingIds.has(String(product._id)))
      .map((product) => ({
        ...product,
        mrp: Number(product.mrp) || Number(product.price) || 0,
      }));

    if (missingProducts.length > 0) {
      await products.insertMany(missingProducts, { ordered: false });
    }

    const migratedCount = await products.countDocuments({ _id: { $in: legacyIds } });
    if (migratedCount !== legacyIds.length) {
      throw new Error(
        `Migration verification failed: expected ${legacyIds.length}, found ${migratedCount}`,
      );
    }

    await legacyProducts.drop();
    console.log(
      `Product migration complete. Copied ${missingProducts.length} missing product(s) and removed ${LEGACY_COLLECTION}.`,
    );
  }
} finally {
  await mongoose.disconnect();
}
