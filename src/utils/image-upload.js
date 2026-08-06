import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import {
  resolveFolder,
  resolveStoragePath,
  toPublicPath,
  uploadsRoot,
} from "../config/storage.config.js";

export const slugify = (value = "image") => {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");

  return slug || "image";
};

/**
 * Resize to webp and write under uploads/<folder>/.
 *
 * Returns `{ image, public_id }` — the same shape the Cloudinary version
 * returned, so call sites and schemas are unchanged. Both fields now hold the
 * relative path (`/uploads/products/x.webp`); `public_id` is kept only because
 * five schemas and the delete path already reference it by that name.
 */
export const saveImageAsset = async ({
  file,
  folder = "products",
  name = "image",
  width = 500,
  height = 500,
  fit = "cover",
  quality = 80,
}) => {
  if (!file) return null;

  const slug = slugify(name);
  const fileName = `${slug}-${Date.now()}.webp`;
  const publicPath = toPublicPath(folder, fileName);
  const absolutePath = join(uploadsRoot, resolveFolder(folder), fileName);

  const processedImage = await sharp(file.buffer)
    .resize(width, height, { fit })
    .webp({ quality })
    .toBuffer();

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, processedImage);

  return {
    image: publicPath,
    public_id: publicPath,
  };
};

/**
 * Delete a stored asset. Accepts the relative path written by saveImageAsset;
 * a leftover Cloudinary public_id from before the migration has no local file
 * and is ignored rather than treated as an error.
 */
export const deleteImageAsset = async (storedPath) => {
  const absolutePath = resolveStoragePath(storedPath);
  if (!absolutePath) return;

  try {
    await unlink(absolutePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    console.error("Local image cleanup failed:", error.message);
  }
};
