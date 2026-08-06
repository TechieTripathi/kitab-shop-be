import ReviewModel from "../reviews/review.model.js";
import SearchAnalytics from "../analytics/SearchAnalytics.model.js";

const METRO_PIN_PREFIXES = new Set([
  "11",
  "12",
  "20",
  "38",
  "40",
  "41",
  "50",
  "56",
  "60",
  "70",
]);
const REMOTE_PIN_PREFIXES = new Set([
  "17",
  "18",
  "19",
  "71",
  "72",
  "73",
  "74",
  "77",
  "78",
  "79",
]);

export const addDeliveryDays = (startDate, days) => {
  const date = new Date(startDate);
  let remaining = days;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0) remaining -= 1;
  }

  return date;
};

export const getDeliveryRange = (pincode) => {
  const prefix = pincode.slice(0, 2);

  if (METRO_PIN_PREFIXES.has(prefix)) return { minDays: 2, maxDays: 4 };
  if (REMOTE_PIN_PREFIXES.has(prefix)) return { minDays: 5, maxDays: 8 };
  return { minDays: 3, maxDays: 6 };
};

export const toBoolean = (value) =>
  value === true || value === "true" || value === "1" || value === 1;

export const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeSearchText = (value = "") =>
  String(value).trim().toLowerCase().replace(/\s+/g, " ");

const levenshtein = (left = "", right = "") => {
  const a = normalizeSearchText(left);
  const b = normalizeSearchText(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? row[j - 1]
          : Math.min(row[j - 1] + 1, previous + 1, row[j] + 1);
      previous = current;
    }
    row[0] = i;
  }
  return row[b.length];
};

export const fuzzyScore = (query, product = {}) => {
  const q = normalizeSearchText(query);
  const words = [
    product.name,
    product.brand,
    product.category_id?.name,
    product.producthightlight,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[\s,|/-]+/)
    .filter((word) => word.length >= 3);

  if (!q || words.length === 0) return 999;
  const queryWords = q.split(/\s+/).filter(Boolean);
  return Math.min(
    ...queryWords.map((queryWord) =>
      Math.min(...words.map((word) => levenshtein(queryWord, word))),
    ),
  );
};

export const trackSearch = ({ req, query, resultCount, source = "search_page", clickedProduct = null }) =>
  SearchAnalytics.create({
    query,
    normalizedQuery: normalizeSearchText(query),
    resultCount,
    source,
    clickedProduct,
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent: req.headers["user-agent"] || "",
  }).catch(() => {});

export const normalizeProductStyles = (value) => {
  let styles = value;
  if (typeof value === "string") {
    try {
      styles = JSON.parse(value);
    } catch {
      styles = {};
    }
  }

  const validFontFamilies = ["default", "serif", "sans", "mono"];
  const validWeights = ["normal", "medium", "semibold", "bold"];
  const validStyles = ["normal", "italic"];
  const clamp = (input, fallback, max = 96) => {
    const number = Number(input);
    if (Number.isNaN(number)) return fallback;
    return Math.min(max, Math.max(1, number));
  };
  const normalizeBlock = (block = {}, fallback = {}) => ({
    fontFamily: validFontFamilies.includes(block.fontFamily) ? block.fontFamily : fallback.fontFamily,
    fontSize: clamp(block.fontSize, fallback.fontSize, fallback.maxSize),
    fontWeight: validWeights.includes(block.fontWeight) ? block.fontWeight : fallback.fontWeight,
    fontStyle: validStyles.includes(block.fontStyle) ? block.fontStyle : fallback.fontStyle,
    textColor: /^#[0-9a-f]{6}$/i.test(String(block.textColor || ""))
      ? block.textColor
      : fallback.textColor,
  });

  return {
    name: normalizeBlock(styles?.name, { fontFamily: "default", fontSize: 14, maxSize: 96, fontWeight: "normal", fontStyle: "normal", textColor: "#1F2937" }),
    brand: normalizeBlock(styles?.brand, { fontFamily: "default", fontSize: 12, maxSize: 64, fontWeight: "normal", fontStyle: "normal", textColor: "#6B7280" }),
    price: normalizeBlock(styles?.price, { fontFamily: "default", fontSize: 18, maxSize: 96, fontWeight: "bold", fontStyle: "normal", textColor: "#111827" }),
    highlights: normalizeBlock(styles?.highlights, { fontFamily: "default", fontSize: 14, maxSize: 64, fontWeight: "normal", fontStyle: "normal", textColor: "#4B5563" }),
    description: normalizeBlock(styles?.description, { fontFamily: "default", fontSize: 14, maxSize: 64, fontWeight: "normal", fontStyle: "normal", textColor: "#4B5563" }),
  };
};

export const normalizeVariants = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  let variants = value;
  if (typeof value === "string") {
    try {
      variants = JSON.parse(value);
    } catch {
      variants = [];
    }
  }
  if (!Array.isArray(variants)) return [];

  return variants
    .map((variant) => {
      const stock = Number(variant.stock || 0);
      const price = variant.price === undefined || variant.price === "" ? null : Number(variant.price);
      const mrp = variant.mrp === undefined || variant.mrp === "" ? null : Number(variant.mrp);
      return {
        name: String(variant.name || "").trim(),
        sku: String(variant.sku || "").trim(),
        attributes:
          variant.attributes && typeof variant.attributes === "object"
            ? variant.attributes
            : {},
        price: Number.isFinite(price) ? price : null,
        mrp: Number.isFinite(mrp) ? mrp : null,
        stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
        reservedStock: Number(variant.reservedStock || 0),
        active: variant.active === undefined ? true : toBoolean(variant.active),
      };
    })
    .filter((variant) => variant.name);
};

export const attachReviewSummary = async (products) => {
  const productList = Array.isArray(products) ? products : [products];
  const ids = productList
    .filter(Boolean)
    .map((product) => product._id);

  if (ids.length === 0) return Array.isArray(products) ? [] : null;

  const summaries = await ReviewModel.aggregate([
    {
      $match: {
        product: { $in: ids },
        status: "published",
      },
    },
    {
      $group: {
        _id: "$product",
        rating: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  const summaryByProduct = new Map(
    summaries.map((summary) => [
      String(summary._id),
      {
        rating: Number(summary.rating.toFixed(1)),
        ratingCount: summary.ratingCount,
      },
    ]),
  );

  const enrichedProducts = productList.map((product) => {
    if (!product) return null;

    const data = product.toObject ? product.toObject() : product;
    const summary = summaryByProduct.get(String(data._id)) || {
      rating: 0,
      ratingCount: 0,
    };

    return {
      ...data,
      ...summary,
    };
  });

  return Array.isArray(products) ? enrichedProducts : enrichedProducts[0];
};
