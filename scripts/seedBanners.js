import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { saveImageAsset } from "../src/utils/image-upload.js";
import Banner from "../src/modules/banner/Banner.model.js";

dotenv.config();

const MONGO_URL = process.env.mango_url;

const seed = async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("Connected.");

    console.log("Clearing old banners...");
    await Banner.deleteMany({});
    console.log("Old banners cleared.");

    const banners = [
      {
        path: "C:/Users/Hp/.gemini/antigravity/brain/c6d48119-bdb2-4fcf-be81-1d448fd9fafa/premium_astro_1784024962035.jpg",
        data: {
          title: "",
          subtitle: "",
          ctaText: "",
          to: "/",
          order: 1
        }
      },
      {
        path: "C:/Users/Hp/.gemini/antigravity/brain/c6d48119-bdb2-4fcf-be81-1d448fd9fafa/premium_pooja_1784024981293.jpg",
        data: {
          title: "",
          subtitle: "",
          ctaText: "",
          to: "/",
          order: 2
        }
      },
      {
        path: "C:/Users/Hp/.gemini/antigravity/brain/c6d48119-bdb2-4fcf-be81-1d448fd9fafa/premium_rudraksha_1784024998125.jpg",
        data: {
          title: "",
          subtitle: "",
          ctaText: "",
          to: "/",
          order: 3
        }
      }
    ];

    for (let i = 0; i < banners.length; i++) {
      const item = banners[i];
      console.log(`Processing banner ${i + 1}...`);
      const buffer = fs.readFileSync(item.path);
      const file = { buffer };

      const imageResult = await saveImageAsset({
        file,
        folder: "astro-banners",
        name: `premium-banner-${i + 1}`,
        width: 1600,
        height: 600,
        fit: "cover",
        quality: 90
      });

      console.log(`Saved image: ${imageResult.image}`);

      await Banner.create({
        ...item.data,
        bg: imageResult.image,
        public_id: imageResult.public_id
      });
      console.log(`Saved banner ${i + 1} to DB.`);
    }

    console.log("All banners seeded successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding banners:", error);
    process.exit(1);
  }
};

seed();
