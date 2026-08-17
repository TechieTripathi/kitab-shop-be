import express from "express";
import {
	CreateInventory,
	GetAllInventory,
	GetInventoryByProduct,
	GetInventorySettings,
	InsertMissingInventoryFromProducts,
	UpdateInventorySettings,
	UpdateStock,
} from "./inventory.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.post("/create", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), CreateInventory);//done
routes.post("/insert-missing", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), InsertMissingInventoryFromProducts);//done
routes.get("/settings", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), GetInventorySettings);
routes.patch("/settings", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), UpdateInventorySettings);
// Both reads were completely unauthenticated: anyone could enumerate stock levels,
// low-stock thresholds and reorder points across the whole catalogue. Nothing in the
// storefront calls them — only the admin panel does — so gating them breaks nothing.
routes.get("/get-inventory", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), GetAllInventory);
routes.get("/:productId", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), GetInventoryByProduct);
routes.put("/:productId", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), UpdateStock); //done

export default routes;
