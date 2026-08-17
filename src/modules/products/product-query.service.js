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
    // `previous` must hold the row-above value at column j-1 (the diagonal),
    // captured before this column is overwritten for row i. Setting row[0]
    // to `i` has to happen up front too, since it is read as `row[j - 1]`
    // once the inner loop reaches j = 1.
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? previous
          : Math.min(row[j - 1] + 1, previous + 1, row[j] + 1);
      previous = current;
    }
  }
  return row[b.length];
};

// How well a product's own text matches the typed query, independent of the
// fuzzy/typo-tolerant scorer below — this ranks *among already-matching*
// products (e.g. name-starts-with beats brand-only-contains), which a plain
// popularity sort has no way to express. Lower is better, matching
// fuzzyScore's convention.
export const computeRelevanceScore = (query, product = {}) => {
  const q = normalizeSearchText(query);
  if (!q) return 7;

  const name = normalizeSearchText(product.name);
  const brand = normalizeSearchText(product.brand);
  const author = normalizeSearchText(product.author);
  const highlight = normalizeSearchText(product.producthightlight);
  const description = normalizeSearchText(product.description);
  const wordBoundary = new RegExp(`\\b${escapeRegex(q)}\\b`);

  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (wordBoundary.test(name)) return 2;
  if (name.includes(q)) return 3;
  // An author match outranks a publisher (brand) match: shoppers search
  // authors by name far more often than publishers.
  if (author === q || author.startsWith(q)) return 4;
  if (brand === q || brand.startsWith(q)) return 4;
  if (author.includes(q)) return 5;
  if (brand.includes(q) || highlight.includes(q)) return 5;
  if (description.includes(q)) return 6;
  return 7;
};

export const fuzzyScore = (query, product = {}) => {
  const q = normalizeSearchText(query);
  const words = [
    product.name,
    product.brand,
    product.author,
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

/**
 * Refuses a variant payload the backend cannot actually store.
 *
 * `normalizeVariants` below is a NORMALISER: everything it does not recognise it
 * quietly drops. That is the right shape for a normaliser and the wrong shape for
 * a write endpoint, and the combination destroyed real administrator input.
 *
 * The admin product form posts an OPTION-GROUP structure — the axes of variation:
 *
 *   [{ name: "Size", options: [{ name: "M", price: 500, mrp: 700 }, …] }]
 *
 * while `variants[]` in the schema is the per-COMBINATION list, each entry with its
 * own attributes, price and stock. Those are two different things — every commerce
 * platform models Options and Variants separately — so the normaliser found no
 * `attributes`, no `price` and no `stock` on the outer object, ignored `options`
 * entirely, and stored:
 *
 *   [{ name: "Size", sku: "", attributes: {}, price: null, mrp: null, stock: 0, … }]
 *
 * Every size, price and MRP the admin typed was gone, with a 200 response. Worse
 * than losing it: `variants.length > 0` then makes `hasVariantStock` true while
 * `variantKeyOf` yields "", so `findVariant` never matches and availability falls
 * back to `product.stock` — silently undoing the variant-aware stock enforcement
 * the cart and checkout paths implement.
 *
 * Option groups are now SUPPORTED and expanded by `expandOptionGroup` below — one
 * axis, one row per option, each carrying its own price, MRP and stock. What is
 * still refused is a group whose options do not carry the fields a variant needs,
 * because expanding those would put stock 0 on every row and produce variants nobody
 * can buy. The rule throughout is the same: never guess, never discard.
 *
 * Called before any persistence, so a rejected payload leaves the product untouched.
 *
 * @returns {string|null} A message describing the problem, or null when acceptable.
 */
/** Parses the payload, or returns null when it is not usable JSON/an array. */
const readVariantPayload = (value) => {
  let variants = value;
  if (typeof value === "string") {
    try {
      variants = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return Array.isArray(variants) ? variants : null;
};

/**
 * True when the payload describes an AXIS of variation rather than combinations.
 *
 * `[{ name: "Size", options: [{ name: "M", price, mrp, stock }, …] }]` — what the
 * admin product form sends. Detected by the presence of `options`, which a
 * per-combination variant never has.
 */
const isOptionGroupPayload = (variants) =>
  variants.length > 0 &&
  variants.every(
    (variant) => variant && typeof variant === "object" && Array.isArray(variant.options),
  );

/**
 * Turns one option group into per-combination variants.
 *
 *   { name: "Size", options: [{ name: "M", price: 500, mrp: 700, stock: 12 }] }
 *        ↓
 *   [{ name: "M", attributes: { Size: "M" }, price: 500, mrp: 700, stock: 12, … }]
 *
 * The attribute key is the GROUP name and the value is the OPTION name, so the
 * resulting variantKey is `Size:M` — exactly what the storefront produces from
 * `selectedVariants: { Size: "M" }` via variantKeyFrom. That equality is the whole
 * point: it is what lets a cart line, an order line and a stock decrement all
 * resolve to the same variant.
 *
 * Deliberately single-axis. Two axes would need a Cartesian product, and which
 * combinations actually exist (and what stock each holds) is a merchandising
 * decision, not something to infer — so a multi-group payload is refused rather
 * than guessed at.
 */
const expandOptionGroup = (group) => {
  const groupName = String(group.name || "").trim();
  return group.options.map((option) => {
    const name = String(option.name ?? "").trim();
    const price = option.price === undefined || option.price === "" ? null : Number(option.price);
    const mrp = option.mrp === undefined || option.mrp === "" ? null : Number(option.mrp);
    const stock = Number(option.stock);
    return {
      name,
      sku: String(option.sku || "").trim(),
      attributes: { [groupName]: name },
      price: Number.isFinite(price) ? price : null,
      mrp: Number.isFinite(mrp) ? mrp : null,
      stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
      reservedStock: Number(option.reservedStock || 0),
      active: option.active === undefined ? true : toBoolean(option.active),
    };
  });
};

/** The canonical variants a payload resolves to, whichever shape it arrived in. */
export const resolveVariantPayload = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const variants = readVariantPayload(value);
  if (!variants) return [];
  if (isOptionGroupPayload(variants)) return expandOptionGroup(variants[0]);
  return normalizeVariants(variants) || [];
};

/**
 * A variant selling above the MRP it will be shown against, described — or "" when it is fine.
 *
 * MRP is the *maximum* retail price, so price > mrp is never a legitimate state; the discount
 * a storefront derives from the pair goes negative. Equal is allowed — that is a variant sold
 * at MRP with no discount.
 *
 * The MRP compared against is the EFFECTIVE one, which is the subtle part. A variant may omit
 * its own MRP, and the product page then falls back to the product's:
 *
 *     const displayMrp = selectedSizeOpt?.mrp ? selectedSizeOpt.mrp : product.mrp;
 *
 * So checking a variant only against its OWN mrp leaves a hole exactly where that fallback
 * happens — a ₹900 size with no MRP under a ₹500 product MRP is displayed as ₹900 against
 * ₹500. Falling back here the same way the display does closes it.
 *
 * Shared by both payload shapes so the option-group and per-combination forms cannot disagree.
 */
const optionPriceAboveMrp = (row, productMrp) => {
  const hasPrice = row.price !== undefined && row.price !== "";
  if (!hasPrice) return "";
  const price = Number(row.price);
  if (!Number.isFinite(price)) return "";

  const hasOwnMrp = row.mrp !== undefined && row.mrp !== "";
  const ownMrp = Number(row.mrp);
  const usesOwnMrp = hasOwnMrp && Number.isFinite(ownMrp);

  // Nothing to compare against: no MRP on the row and none known for the product.
  const fallbackMrp = Number(productMrp);
  if (!usesOwnMrp && !Number.isFinite(fallbackMrp)) return "";

  const mrp = usesOwnMrp ? ownMrp : fallbackMrp;
  if (price <= mrp) return "";

  const which = usesOwnMrp ? "its MRP" : "the product's MRP";
  return `has a price (₹${price}) above ${which} (₹${mrp}). MRP is the maximum retail price, so the selling price must be equal to or below it.`;
};

export const findUnsupportedVariantFormat = (value, productMrp) => {
  // Omitted entirely means "don't change variants" — not an error.
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "string") {
    try {
      JSON.parse(value);
    } catch {
      // The normaliser turned this into [], wiping every existing variant on an
      // update because one field arrived malformed.
      return "Variants must be valid JSON.";
    }
  }

  const variants = readVariantPayload(value);
  if (!variants) {
    return "Variants must be an array of variant combinations, or one option group.";
  }

  // ── OPTION-GROUP PAYLOAD ─────────────────────────────────────────────────
  if (isOptionGroupPayload(variants)) {
    if (variants.length > 1) {
      return (
        "Only one option group is supported. Multiple axes would have to be combined " +
        "into individual variants, and which combinations exist is a merchandising " +
        "decision — send the combinations directly instead."
      );
    }
    const group = variants[0];
    if (!String(group.name || "").trim()) {
      return "The option group needs a name (for example \"Size\").";
    }
    if (group.options.length === 0) {
      return "The option group has no options. Remove it, or add at least one option.";
    }
    const seen = new Set();
    for (let index = 0; index < group.options.length; index += 1) {
      const option = group.options[index];
      const at = `Option ${index + 1}`;
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        return `${at} is not an option object.`;
      }
      const name = String(option.name ?? "").trim();
      if (!name) return `${at} needs a name.`;
      if (seen.has(name)) {
        return `Option "${name}" appears twice. Each option must be unique — two rows with the same name would collide on one variant.`;
      }
      seen.add(name);
      // The reason a group used to be refused outright: without per-option stock
      // every expanded variant would hold 0 and be unbuyable, which is silent
      // failure of a different kind.
      const stock = Number(option.stock);
      if (option.stock === undefined || option.stock === "" || !Number.isFinite(stock)) {
        return `${at} ("${name}") needs a stock quantity. Each option is stocked separately.`;
      }
      if (!Number.isInteger(stock) || stock < 0) {
        return `${at} ("${name}") needs a whole, non-negative stock quantity.`;
      }
      for (const field of ["price", "mrp"]) {
        if (option[field] === undefined || option[field] === "") continue;
        const numeric = Number(option[field]);
        if (!Number.isFinite(numeric) || numeric < 0) {
          return `${at} ("${name}") has an invalid ${field}.`;
        }
      }
      const priceAboveMrp = optionPriceAboveMrp(option, productMrp);
      if (priceAboveMrp) return `${at} ("${name}") ${priceAboveMrp}`;
    }
    return null;
  }

  // ── CANONICAL PER-COMBINATION PAYLOAD ────────────────────────────────────
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const at = `Variant ${index + 1}`;

    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      return `${at} is not a variant object.`;
    }

    // Dropped by the normaliser's trailing .filter(v => v.name).
    if (!String(variant.name || "").trim()) {
      return `${at} needs a name.`;
    }

    // Without attributes there is nothing to match a cart or order line
    // against: the storefront only ever produces attribute keys (e.g.
    // "Size:vishnu"), never a SKU, so a variant without attributes can never
    // be found and every line naming it silently falls through to
    // product-level stock — the exact counter divergence this guard exists to
    // stop. (A SKU alone used to be accepted here; it never matched anything.)
    const attributes = variant.attributes;
    const attributeKeys =
      attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? Object.keys(attributes)
        : [];
    const hasAttributes = attributeKeys.length > 0;
    if (!hasAttributes) {
      return `${at} needs attributes (e.g. { "size": "M" }), so cart and order lines can be matched to it.`;
    }
    // A blank attribute NAME produces an unmatchable key (":value") — same
    // divergence through a different door.
    if (attributeKeys.some((key) => !String(key).trim())) {
      return `${at} has an attribute with a blank name — every attribute needs a name (e.g. "size").`;
    }

    const priceAboveMrp = optionPriceAboveMrp(variant, productMrp);
    if (priceAboveMrp) return `${at} ("${variant.name}") ${priceAboveMrp}`;
  }

  return null;
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
