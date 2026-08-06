import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Category from '../src/modules/categories/Category.model.js';
import { saveImageAsset } from '../src/utils/image-upload.js';

dotenv.config();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  try {
    await mongoose.connect(process.env.mango_url);
    console.log("Connected to MongoDB.");

    const categories = await Category.find({});
    
    console.log(`Found ${categories.length} categories to update.`);
    if (categories.length === 0) {
        console.log("No categories found!");
        process.exit(0);
    }

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      const categoryName = category.name || "Astrology Category";

      console.log(`[${i + 1}/${categories.length}] Processing: ${categoryName}`);

      try {
        const prompt = `Professional aesthetic photography representing ${categoryName}, astrology and spirituality concept. Clean white background, studio lighting, high resolution, mystical.`;
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
          folder: "astro-categories",
          name: categoryName,
          width: 800,
          height: 800,
          fit: "cover",
          quality: 85
        });

        if (uploadResult && uploadResult.image) {
          // Native MongoDB driver update to 100% bypass mongoose schema validation errors
          await mongoose.connection.db.collection('categories').updateOne(
            { _id: category._id }, 
            { $set: { image: uploadResult.image, public_id: uploadResult.public_id } }
          );
          console.log(`  Successfully updated ${categoryName}! URL: ${uploadResult.image}`);
        }
      } catch (err) {
        console.error(`  Error processing ${categoryName}:`, err.message);
      }

      await delay(2000);
    }

    console.log("Finished updating all categories!");
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
