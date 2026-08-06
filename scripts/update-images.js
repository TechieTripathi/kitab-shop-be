import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../src/modules/products/Product.model.js';
import { saveImageAsset } from '../src/utils/image-upload.js';

dotenv.config();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  try {
    await mongoose.connect(process.env.mango_url);
    console.log("Connected to MongoDB.");

    const allProducts = await Product.find({});
    // Find products that don't have 'astro-products' in URL
    const products = allProducts.filter(p => !p.image || !p.image.includes('astro-products'));
    
    console.log(`Found ${products.length} products to update.`);
    if (products.length === 0) {
        console.log("All products already updated!");
        process.exit(0);
    }

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productName = product.name || "Astrology Product";

      console.log(`[${i + 1}/${products.length}] Processing: ${productName}`);

      try {
        const prompt = `Professional ecommerce product photography of ${productName}. Clean white background, studio lighting, high resolution, photorealistic astrology item.`;
        const encodedPrompt = encodeURIComponent(prompt);
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=800&nologo=true`;

        console.log(`  Fetching image from AI...`);
        let response;
        for (let retries = 0; retries < 3; retries++) {
            try {
                response = await fetch(url);
                if (response.ok) break;
            } catch (e) {
                console.log(`  Retry ${retries + 1}...`);
                await delay(2000);
            }
        }

        if (!response || !response.ok) {
          throw new Error(`Failed to fetch image after retries`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`  Saving to uploads...`);
        const uploadResult = await saveImageAsset({
          file: { buffer },
          folder: "astro-products",
          name: productName,
          width: 800,
          height: 800,
          fit: "cover",
          quality: 85
        });

        if (uploadResult && uploadResult.image) {
          // Native MongoDB driver update to 100% bypass mongoose schema validation errors
          await mongoose.connection.db.collection('products').updateOne(
            { _id: product._id }, 
            { $set: { image: uploadResult.image, public_id: uploadResult.public_id } }
          );
          console.log(`  Successfully updated ${productName}! URL: ${uploadResult.image}`);
        }
      } catch (err) {
        console.error(`  Error processing ${productName}:`, err.message);
      }

      await delay(2000);
    }

    console.log("Finished updating missing products!");
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
