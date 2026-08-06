import Banner from "./Banner.model.js";
import { deleteImageAsset, saveImageAsset, slugify } from "../../utils/image-upload.js";

const toBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
};

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isNaN(number) ? fallback : number;
};

const clamp = (value, fallback, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, 1), max);
};

const validFontFamilies = ["default", "serif", "sans", "mono"];
const validWeights = ["normal", "medium", "semibold", "bold"];
const validStyles = ["normal", "italic"];

const normalizeBannerStyles = (value, colors = {}) => {
  let styles = value;
  if (typeof value === "string") {
    try {
      styles = JSON.parse(value);
    } catch (_) {
      styles = {};
    }
  }

  const normalizeBlock = (block = {}, fallback) => ({
    fontFamily: validFontFamilies.includes(block.fontFamily) ? block.fontFamily : fallback.fontFamily,
    fontSize: clamp(block.fontSize, fallback.fontSize, fallback.maxSize),
    fontWeight: validWeights.includes(block.fontWeight) ? block.fontWeight : fallback.fontWeight,
    fontStyle: validStyles.includes(block.fontStyle) ? block.fontStyle : fallback.fontStyle,
    textColor: block.textColor || fallback.textColor,
  });

  return {
    title: normalizeBlock(styles?.title, {
      fontFamily: "default",
      fontSize: 36,
      maxSize: 96,
      fontWeight: "bold",
      fontStyle: "normal",
      textColor: colors.titleColor || "#ffffff",
    }),
    subtitle: normalizeBlock(styles?.subtitle, {
      fontFamily: "default",
      fontSize: 16,
      maxSize: 64,
      fontWeight: "normal",
      fontStyle: "normal",
      textColor: colors.subtitleColor || "#f3f4f6",
    }),
    cta: normalizeBlock(styles?.cta, {
      fontFamily: "default",
      fontSize: 16,
      maxSize: 64,
      fontWeight: "bold",
      fontStyle: "normal",
      textColor: colors.ctaText || "#000000",
    }),
  };
};

const saveBannerImage = async (file, title = "") => {
  const name = slugify(title || "banner");

  return saveImageAsset({
    file,
    folder: "banners",
    name,
    width: 1600,
    height: 600,
    fit: "cover",
    quality: 82,
  });
};

const buildBannerPayload = (body = {}) => {
  const payload = {};
  const fields = [
    "title",
    "titleColor",
    "subtitle",
    "subtitleColor",
    "cta",
    "ctaBg",
    "ctaText",
    "alignment",
    "to",
  ];

  for (const field of fields) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (body.overlayOpacity !== undefined) {
    payload.overlayOpacity = toNumber(body.overlayOpacity, 0);
  }
  if (body.order !== undefined) {
    payload.order = toNumber(body.order, 0);
  }
  if (body.isActive !== undefined) {
    payload.isActive = toBoolean(body.isActive, true);
  }
  if (body.styles !== undefined) {
    payload.styles = normalizeBannerStyles(body.styles, {
      titleColor: payload.titleColor || body.titleColor,
      subtitleColor: payload.subtitleColor || body.subtitleColor,
      ctaText: payload.ctaText || body.ctaText,
    });
  }

  return payload;
};

export const CreateBanner = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Banner image is required" });
    }

    const payload = buildBannerPayload(req.body);
    const imageResult = await saveBannerImage(req.file, payload.title);

    const banner = await Banner.create({
      ...payload,
      bg: imageResult.image,
      public_id: imageResult.public_id,
    });

    return res.status(201).json({
      message: "Banner created successfully",
      data: banner,
    });
  } catch (error) {
    console.error("CreateBanner Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const GetAllBanners = async (req, res) => {
  try {
    const includeInactive =
      String(req.query.includeInactive || "").toLowerCase() === "true";
    const filter = includeInactive ? {} : { isActive: true };
    const banners = await Banner.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      message: "Banners fetched successfully",
      data: banners,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const GetBannerById = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id).lean();

    if (!banner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    return res.status(200).json({
      message: "Banner fetched successfully",
      data: banner,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const UpdateBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);

    if (!banner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    Object.assign(banner, buildBannerPayload(req.body));

    if (req.file) {
      const imageResult = await saveBannerImage(req.file, banner.title);
      await deleteImageAsset(banner.public_id);

      banner.bg = imageResult.image;
      banner.public_id = imageResult.public_id;
    }

    await banner.save();

    return res.status(200).json({
      message: "Banner updated successfully",
      data: banner,
    });
  } catch (error) {
    console.error("UpdateBanner Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const DeleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);

    if (!banner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    await deleteImageAsset(banner.public_id);

    return res.status(200).json({
      message: "Banner deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
