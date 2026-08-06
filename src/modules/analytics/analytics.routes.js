import express from "express";
import { TrackPageView, GetPageViews, TrackVisitor, GetDailyTraffic, GetSearchAnalytics, ExportSearchAnalytics, GetNotificationEvents } from "./analytics.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.post("/track-page", TrackPageView);
routes.post("/track-visitor", TrackVisitor);
routes.get("/page-views", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.ANALYTICS_READ), GetPageViews);
routes.get("/traffic", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.ANALYTICS_READ), GetDailyTraffic);
routes.get("/search", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.ANALYTICS_READ), GetSearchAnalytics);
routes.get("/search/export", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.ANALYTICS_READ), ExportSearchAnalytics);
routes.get("/notifications", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.ANALYTICS_READ), GetNotificationEvents);

export default routes;
