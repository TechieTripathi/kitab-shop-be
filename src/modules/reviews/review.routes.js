import express from "express";
import {
  CreateOrUpdateReview,
  DeleteReview,
  GetMyReviews,
  GetAdminReviews,
  GetProductReviews,
  GetReviewEligibility,
  UpdateReview,
  UpdateAdminReviewStatus,
  DeleteAdminReview,
} from "./review.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";
import image from "../../middleware/image.middleware.js";
import { contentWriteRateLimit } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  adminReviewStatusSchema,
  createReviewSchema,
  productIdParamSchema,
  reviewIdParamSchema,
  updateReviewSchema,
} from "./review.schema.js";

const routes = express.Router();

routes.get("/product/:productId", validate(productIdParamSchema), GetProductReviews);
routes.get(
  "/product/:productId/eligibility",
  TokenVerify,
  validate(productIdParamSchema),
  GetReviewEligibility,
);
// validate() runs after multer so req.body is populated from the multipart form.
routes.post(
  "/product/:productId",
  contentWriteRateLimit,
  TokenVerify,
  image.single("Review_image"),
  validate(createReviewSchema),
  CreateOrUpdateReview,
);
routes.get("/admin/all", isAdmin, requirePermission(ADMIN_PERMISSIONS.REVIEWS_MANAGE), GetAdminReviews);
routes.patch("/admin/:reviewId/status", isAdmin, requirePermission(ADMIN_PERMISSIONS.REVIEWS_MANAGE), validate(adminReviewStatusSchema), UpdateAdminReviewStatus);
routes.delete("/admin/:reviewId", isAdmin, requirePermission(ADMIN_PERMISSIONS.REVIEWS_MANAGE), validate(reviewIdParamSchema), DeleteAdminReview);
routes.get("/my-reviews", TokenVerify, GetMyReviews);
routes.put("/:reviewId", contentWriteRateLimit, TokenVerify, image.single("Review_image"), validate(updateReviewSchema), UpdateReview);
routes.delete("/:reviewId", TokenVerify, validate(reviewIdParamSchema), DeleteReview);

export default routes;
