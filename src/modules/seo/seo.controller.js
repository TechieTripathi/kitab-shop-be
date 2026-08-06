import { buildRobotsTxt, buildSitemapXml } from "./sitemap.service.js";

// Crawlers re-request these often, so a short shared cache keeps a large
// catalogue from turning every crawl into a full collection scan.
const CACHE_CONTROL = "public, max-age=3600";

export const GetSitemap = async (req, res) => {
  try {
    const xml = await buildSitemapXml();

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", CACHE_CONTROL);
    return res.status(200).send(xml);
  } catch (error) {
    if (error?.status === 503) {
      return res.status(503).json({
        success: false,
        message: "Sitemap is unavailable because SITE_URL is not configured",
      });
    }

    console.error("Failed to build sitemap:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to build sitemap",
    });
  }
};

export const GetRobotsTxt = (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  return res.status(200).send(buildRobotsTxt());
};
