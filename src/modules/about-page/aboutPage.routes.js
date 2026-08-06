import express from "express";
import { GetAboutPage, UpdateAboutPage } from "./aboutPage.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/", GetAboutPage);
routes.put("/", isAdmin, requirePermission(ADMIN_PERMISSIONS.THEME_MANAGE), UpdateAboutPage);

export default routes;
