const META_TITLE_MAX = 160;
const META_DESCRIPTION_MAX = 320;
const MAX_KEYWORDS = 25;
const KEYWORD_MAX_LENGTH = 60;

/**
 * Normalises the keyword field.
 *
 * The admin form sends a single comma-separated string while the API and any
 * bulk import may send an array, so both shapes are accepted and stored as a
 * de-duplicated array.
 */
export const normalizeMetaKeywords = (value) => {
  if (value === undefined || value === null || value === "") return [];

  const raw = Array.isArray(value) ? value : String(value).split(",");

  const cleaned = raw
    .map((keyword) => String(keyword).trim())
    .filter(Boolean)
    .map((keyword) => keyword.slice(0, KEYWORD_MAX_LENGTH));

  // Case-insensitive de-dupe, keeping the first spelling the admin used.
  const seen = new Set();
  const unique = [];
  for (const keyword of cleaned) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(keyword);
  }

  return unique.slice(0, MAX_KEYWORDS);
};

/** Builds a URL-safe slug from arbitrary text. */
export const slugify = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

/**
 * Picks the SEO fields out of a request body.
 *
 * Only keys actually present are returned, so a PATCH-style update cannot blank
 * out metadata it never mentioned.
 */
export const buildSeoFields = ({ metaTitle, metaDescription, metaKeywords, slug, name } = {}) => {
  const fields = {};

  if (metaTitle !== undefined) {
    fields.metaTitle = String(metaTitle || "").trim().slice(0, META_TITLE_MAX);
  }

  if (metaDescription !== undefined) {
    fields.metaDescription = String(metaDescription || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, META_DESCRIPTION_MAX);
  }

  if (metaKeywords !== undefined) {
    fields.metaKeywords = normalizeMetaKeywords(metaKeywords);
  }

  if (slug !== undefined) {
    fields.slug = slugify(slug);
  } else if (name !== undefined) {
    // Derived from the name for sitemap readability. Not unique-constrained, so
    // two products with the same name are a cosmetic duplicate rather than a
    // failed create.
    fields.slug = slugify(name);
  }

  return fields;
};
