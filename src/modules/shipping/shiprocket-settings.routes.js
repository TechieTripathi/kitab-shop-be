import express from "express";
import {
  GetPickupLocations,
  GetShiprocketSettings,
  TestShiprocketConnection,
  UpdateShiprocketSettings,
} from "./shiprocket-settings.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/", TokenVerify, requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE), GetShiprocketSettings);
routes.patch("/", TokenVerify, requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE), UpdateShiprocketSettings);
// POST, not GET: testing performs a real Shiprocket login, so it must not be something
// a browser or proxy can replay by prefetching a URL.
routes.post("/test-connection", TokenVerify, requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE), TestShiprocketConnection);
routes.get("/pickup-locations", TokenVerify, requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE), GetPickupLocations);

export default routes;
