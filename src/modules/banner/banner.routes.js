import express from "express";
import {
  CreateBanner,
  DeleteBanner,
  GetAllBanners,
  GetBannerById,
  UpdateBanner,
} from "./banner.controller.js";
import image from "../../middleware/image.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/all-banners", GetAllBanners);
routes.get("/:id", GetBannerById);

routes.post("/create", isAdmin, requirePermission(ADMIN_PERMISSIONS.BANNERS_MANAGE), image.single("banner_image"), CreateBanner);
routes.put("/update/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.BANNERS_MANAGE), image.single("banner_image"), UpdateBanner);
routes.delete("/delete/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.BANNERS_MANAGE), DeleteBanner);

export default routes;
