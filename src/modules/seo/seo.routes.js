import express from "express";

import { GetRobotsTxt, GetSitemap } from "./seo.controller.js";
import { searchRateLimit } from "../../middleware/rate-limit.middleware.js";

const router = express.Router();

// Public and uncached at the edge, so they share the generous search bucket
// rather than being completely unlimited.
router.get("/sitemap.xml", searchRateLimit, GetSitemap);
router.get("/robots.txt", searchRateLimit, GetRobotsTxt);

export default router;
