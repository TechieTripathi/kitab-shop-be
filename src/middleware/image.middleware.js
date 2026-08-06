import multer from "multer";

const storage = multer.memoryStorage();

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error("Only JPG, PNG, WebP, GIF, and AVIF images are allowed"));
      return;
    }

    callback(null, true);
  },
});

export default upload;
