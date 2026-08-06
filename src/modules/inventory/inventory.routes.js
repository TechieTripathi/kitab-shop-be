import express from "express";
import {
	CreateInventory,
	GetAllInventory,
	GetInventoryByProduct,
	InsertMissingInventoryFromProducts,
	UpdateStock,
} from "./inventory.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.post("/create", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), CreateInventory);//done
routes.post("/insert-missing", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), InsertMissingInventoryFromProducts);//done
routes.get("/get-inventory", GetAllInventory); //done
routes.get("/:productId",  GetInventoryByProduct); //done
routes.put("/:productId", isAdmin, requirePermission(ADMIN_PERMISSIONS.INVENTORY_MANAGE), UpdateStock); //done

export default routes;
