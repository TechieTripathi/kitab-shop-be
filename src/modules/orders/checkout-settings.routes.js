import express from "express";
import { GetCheckoutSettings, UpdateCheckoutSettings } from "./checkout-settings.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/", GetCheckoutSettings);
routes.patch("/", TokenVerify, requirePermission(ADMIN_PERMISSIONS.ORDERS_MANAGE), UpdateCheckoutSettings);

export default routes;
