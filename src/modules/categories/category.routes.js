import express from "express";
import {
  CreateCategory,
  GetAllCategory,
  UpdateCategory,
  DeleteCategory,
} from "./category.controller.js";

import image from "../../middleware/image.middleware.js";

import { TokenVerify } from "../../middleware/auth.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.post(
  "/create",
  isAdmin,
  requirePermission(ADMIN_PERMISSIONS.CATEGORIES_MANAGE),
  image.single("User_image"),

  CreateCategory,
);

routes.get("/get-all", GetAllCategory);

routes.put(
  "/update/:categoryId",
  isAdmin,
  requirePermission(ADMIN_PERMISSIONS.CATEGORIES_MANAGE),
  image.single("User_image"),
  UpdateCategory,
);

routes.delete(
  "/delete/:categoryId",
  isAdmin,
  requirePermission(ADMIN_PERMISSIONS.CATEGORIES_MANAGE),
  DeleteCategory,
);

export default routes;
