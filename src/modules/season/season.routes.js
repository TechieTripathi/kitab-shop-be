import express from "express";
import {
  CreateCustomSeason,
  DeleteCustomSeason,
  GetCustomSeasons,
  UpdateCustomSeason,
} from "./season.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/custom", GetCustomSeasons);
routes.post("/custom", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), CreateCustomSeason);
routes.put("/custom/:slug", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), UpdateCustomSeason);
routes.delete("/custom/:slug", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), DeleteCustomSeason);

export default routes;
