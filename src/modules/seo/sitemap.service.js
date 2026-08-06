import ProductModel from "../products/Product.model.js";
import CategoryModel from "../categories/Category.model.js";

// Static storefront routes worth indexing, with a rough priority ordering.
// Account, admin, cart and checkout routes are excluded on purpose: they are
// private or transient and should never appear in a sitemap.
const STATIC_ROUTES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/products", changefreq: "daily", priority: "0.9" },
  { path: "/categories", changefreq: "weekly", priority: "0.8" },
  { path: "/astrologers", changefreq: "weekly", priority: "0.7" },
  { path: "/blog", changefreq: "weekly", priority: "0.6" },
  { path: "/contact", changefreq: "monthly", priority: "0.4" },
  { path: "/about", changefreq: "monthly", priority: "0.4" },
];

/** Escapes the five characters that are not legal as raw text in XML. */
const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Trailing slashes are stripped so joins never produce a double slash. */
export const resolveSiteUrl = () => {
  const raw = process.env.SITE_URL || process.env.FRONTEND_URL || "";
  return String(raw).trim().replace(/\/+$/, "");
};

const toIsoDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const buildUrlEntry = ({ loc, lastmod, changefreq, priority }) => {
  const parts = [`    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
};

/**
 * Builds a sitemap covering the static routes plus every product and category.
 *
 * Products are addressed by id because that is what the storefront router uses;
 * the stored slug is not in the URL yet.
 */
export const buildSitemapXml = async () => {
  const siteUrl = resolveSiteUrl();
  if (!siteUrl) {
    throw Object.assign(new Error("SITE_URL is not configured"), { status: 503 });
  }

  const [products, categories] = await Promise.all([
    ProductModel.find({}, { updatedAt: 1 }).lean(),
    CategoryModel.find({}, { updatedAt: 1 }).lean(),
  ]);

  const entries = [
    ...STATIC_ROUTES.map((route) =>
      buildUrlEntry({
        loc: `${siteUrl}${route.path}`,
        changefreq: route.changefreq,
        priority: route.priority,
      }),
    ),
    ...categories.map((category) =>
      buildUrlEntry({
        loc: `${siteUrl}/category/${category._id}`,
        lastmod: toIsoDate(category.updatedAt),
        changefreq: "weekly",
        priority: "0.7",
      }),
    ),
    ...products.map((product) =>
      buildUrlEntry({
        loc: `${siteUrl}/product/${product._id}`,
        lastmod: toIsoDate(product.updatedAt),
        changefreq: "weekly",
        priority: "0.8",
      }),
    ),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
};

/**
 * Builds robots.txt.
 *
 * Private and transactional areas are disallowed so crawlers do not waste
 * budget on pages that require a session.
 */
export const buildRobotsTxt = () => {
  const siteUrl = resolveSiteUrl();

  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /account",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /order-success",
    "Disallow: /login",
    "Disallow: /signup",
  ];

  if (siteUrl) {
    lines.push("", `Sitemap: ${siteUrl}/api/v1/seo/sitemap.xml`);
  }

  return `${lines.join("\n")}\n`;
};
