import express from "express";
import { GetFooterSettings, UpdateFooterSettings } from "./footer.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/settings", GetFooterSettings);
routes.put("/settings", isAdmin, requirePermission(ADMIN_PERMISSIONS.THEME_MANAGE), UpdateFooterSettings);

export default routes;
