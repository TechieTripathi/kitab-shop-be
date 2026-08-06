import express from "express";
import {
  CreateCustomFestival,
  DeleteCustomFestival,
  GetCustomFestivals,
  UpdateCustomFestival,
} from "./festival.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/custom", GetCustomFestivals);
routes.post("/custom", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), CreateCustomFestival);
routes.put("/custom/:slug", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), UpdateCustomFestival);
routes.delete("/custom/:slug", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_MANAGE), DeleteCustomFestival);

export default routes;
