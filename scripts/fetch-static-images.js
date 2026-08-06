/**
 * Pull the frontend's hardcoded third-party images into uploads/static/ so the
 * app stops hotlinking transparenttextures.com, Unsplash and placehold.co.
 *
 *   node scripts/fetch-static-images.js
 *
 * These are not user uploads and never change at runtime, so unlike
 * uploads/<type>/ this folder IS committed — see .gitignore.
 *
 * Safe to re-run: an existing non-empty file is left alone.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { uploadsRoot } from "../src/config/storage.config.js";

const staticDir = join(uploadsRoot, "static");

// Tiling background texture used by 19 admin screens. Kept as PNG: it relies on
// an alpha channel and is re-tiled by CSS, so webp buys nothing here.
const RAW_ASSETS = [
  {
    fileName: "stardust.png",
    url: "https://www.transparenttextures.com/patterns/stardust.png",
  },
  // Shown when the homepage has no banner configured. It only ever existed as a
  // constant in the frontend, so the database sweep never saw it.
  {
    fileName: "default-banner.webp",
    url: "https://res.cloudinary.com/dbi2izwfz/image/upload/v1783709577/astro-banners/homepage-default-banner-1783709055493.webp",
  },
];

// Blog hero images, previously hotlinked from Unsplash by src/data/blogPosts.js.
const BLOG_IMAGES = [
  ["how-to-choose-the-right-gemstone", "photo-1613843351058-1dd06fda7c02"],
  ["rudraksha-mukhi-guide", "photo-1562960364-f47d48567cf0"],
  ["vastu-tips-for-new-home", "photo-1554020632-57ebe4b1933f"],
  ["understanding-mangal-dosha", "photo-1729335511904-9b8690184935"],
  ["diwali-pooja-vidhi-checklist", "photo-1605292356183-a77d0a9c9d1d"],
  ["live-astrology-consultation-guide", "photo-1737317312025-d0b8f9f687ec"],
].map(([slug, photoId]) => ({
  fileName: `blog-${slug}.webp`,
  url: `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1000&h=600&q=80`,
  resize: { width: 1000, height: 600, fit: "cover" },
}));

const exists = async (path) => {
  const info = await stat(path).catch(() => null);
  return info?.size > 0;
};

const fetchAsset = async ({ fileName, url, resize }) => {
  const target = join(staticDir, fileName);

  if (await exists(target)) {
    console.log(`  = ${fileName} (already present)`);
    return "cached";
  }

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`  ! ${fileName}: HTTP ${response.status}`);
    return "failed";
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const output = resize
    ? await sharp(buffer).resize(resize).webp({ quality: 82 }).toBuffer()
    : buffer;

  await writeFile(target, output);
  console.log(`  + ${fileName} (${Math.round(output.length / 1024)} kB)`);
  return "downloaded";
};

/**
 * A neutral local stand-in for the placehold.co URLs the frontend used for
 * missing images. Generated rather than downloaded so this script has no
 * external dependency for the one asset every broken <img> falls back to.
 */
const buildPlaceholder = async () => {
  const target = join(staticDir, "placeholder.webp");

  if (await exists(target)) {
    console.log("  = placeholder.webp (already present)");
    return "cached";
  }

  const size = 600;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" fill="#f0ebe8"/>
       <circle cx="${size / 2}" cy="${size / 2 - 28}" r="72" fill="none"
               stroke="#8B6914" stroke-width="8" opacity="0.55"/>
       <path d="M${size / 2 - 46} ${size / 2 + 84} h92" stroke="#8B6914"
             stroke-width="8" stroke-linecap="round" opacity="0.55"/>
     </svg>`,
  );

  const output = await sharp(svg).webp({ quality: 82 }).toBuffer();
  await writeFile(target, output);
  console.log(`  + placeholder.webp (${Math.round(output.length / 1024)} kB)`);
  return "downloaded";
};

await mkdir(staticDir, { recursive: true });
console.log(`Fetching static assets into ${staticDir}\n`);

const results = [];
for (const asset of [...RAW_ASSETS, ...BLOG_IMAGES]) {
  results.push(await fetchAsset(asset));
}
results.push(await buildPlaceholder());

const counts = results.reduce(
  (acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }),
  {},
);

console.log(
  `\n${counts.downloaded || 0} written, ${counts.cached || 0} already present, ${
    counts.failed || 0
  } failed`,
);

if (counts.failed) process.exitCode = 1;
