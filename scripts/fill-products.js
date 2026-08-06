import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Category from '../src/modules/categories/Category.model.js';
import Product from '../src/modules/products/Product.model.js';
import { saveImageAsset } from '../src/utils/image-upload.js';

dotenv.config();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adjectives = ["Premium", "Authentic", "Sacred", "Blessed", "Mystic", "Divine", "Natural", "Pure", "Exclusive"];
function getRandomAdjective() {
    return adjectives[Math.floor(Math.random() * adjectives.length)];
}

async function main() {
  try {
    await mongoose.connect(process.env.mango_url);
    console.log("Connected to MongoDB.");

    const categories = await Category.find({});
    
    let totalAdded = 0;

    for (const cat of categories) {
        const count = await Product.countDocuments({ category_id: cat._id });
        const needed = 9 - count;

        if (needed <= 0) {
            console.log(`[${cat.name}] already has ${count} products. Skipping.`);
            continue;
        }

        console.log(`[${cat.name}] has ${count} products. Adding ${needed} more...`);

        for (let i = 0; i < needed; i++) {
            const productName = `${getRandomAdjective()} ${cat.name} Item ${i + 1}`;
            console.log(`  -> Creating: ${productName}`);

            try {
                // Generate Image
                const prompt = `Professional ecommerce product photography of ${productName}, astrology and spirituality concept. Clean white background, studio lighting, high resolution, mystical.`;
                const encodedPrompt = encodeURIComponent(prompt);
                const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=800&nologo=true`;

                let response;
                for (let retries = 0; retries < 3; retries++) {
                    try {
                        response = await fetch(url);
                        if (response.ok) break;
                    } catch (e) {
                        await delay(2000);
                    }
                }

                if (!response || !response.ok) throw new Error("Fetch failed");
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Resize and save under uploads/
                const uploadResult = await saveImageAsset({
                    file: { buffer },
                    folder: "astro-products",
                    name: productName,
                    width: 800,
                    height: 800,
                    fit: "cover",
                    quality: 85
                });

                // Save Product
                const newProduct = new Product({
                    category_id: cat._id,
                    name: productName,
                    description: `This is a highly spiritual and blessed ${cat.name} item designed to bring positivity and peace into your life.`,
                    price: 999 + Math.floor(Math.random() * 2000),
                    mrp: 2999 + Math.floor(Math.random() * 3000),
                    producthightlight: "100% Authentic, Blessed by priests, Premium Quality",
                    stock: 50,
                    brand: "AstroWala",
                    image: uploadResult.image,
                    public_id: uploadResult.public_id
                });

                await newProduct.save();
                totalAdded++;
                console.log(`     Successfully added! URL: ${uploadResult.image}`);

            } catch (err) {
                console.error(`     Error creating ${productName}:`, err.message);
            }
            
            await delay(2000); // polite delay for the free API
        }
    }

    console.log(`Finished! Total products added: ${totalAdded}`);
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
