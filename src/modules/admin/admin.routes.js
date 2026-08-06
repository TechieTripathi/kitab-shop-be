import express from "express";
import {
  BlockUser,
  BulkImportProducts,
  BulkUpdateProducts,
  ExportProducts,
  GetAdminPermissions,
  GetAllUsers,
  GetDashboard,
  GetSalesReport,
  UnBlockUser,
  UpdateUserPermissions,
} from "./admin.controller.js";
import { ExportAuditLogs, GetAuditLogs } from "../audit/audit.controller.js";
import {
  AdminCreateCoupon,
  AdminDeleteCoupon,
  AdminGetCoupons,
  AdminUpdateCoupon,
  AdminCouponUsageReport,
  ExportCouponUsageReport,
} from "../coupons/coupon.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";
import { GetLoginActivities } from "../login-activity/login-activity.controller.js";
import {
  AdminGetReturns,
  AdminUpdateReturnStatus,
} from "../returns/return.controller.js";
import { UpdateHomepageSettings } from "../homepage/homepage.controller.js";
import {
  AdminCreateCmsBlock,
  AdminDeleteCmsBlock,
  AdminGetCmsBlocks,
  AdminUpdateCmsBlock,
} from "../cms/cms.controller.js";

const router = express.Router();

router.get("/dashboard", isAdmin, requirePermission(ADMIN_PERMISSIONS.DASHBOARD_READ), GetDashboard);
router.get("/permissions", isAdmin, GetAdminPermissions);
router.patch("/users/:id/permissions", isAdmin, requirePermission(ADMIN_PERMISSIONS.USERS_MANAGE), UpdateUserPermissions);
router.get("/audit-logs", isAdmin, requirePermission(ADMIN_PERMISSIONS.AUDIT_READ), GetAuditLogs);
router.get("/audit-logs/export", isAdmin, requirePermission(ADMIN_PERMISSIONS.AUDIT_READ), ExportAuditLogs);
router.get("/login-activities", isAdmin, GetLoginActivities);
router.get("/returns", isAdmin, requirePermission(ADMIN_PERMISSIONS.RETURNS_MANAGE), AdminGetReturns);
router.patch("/returns/:id/status", isAdmin, requirePermission(ADMIN_PERMISSIONS.RETURNS_MANAGE), AdminUpdateReturnStatus);
router.get("/all-users", isAdmin, GetAllUsers);
router.put("/block/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.USERS_MANAGE), BlockUser);
router.put("/unblock/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.USERS_MANAGE), UnBlockUser);
router.get("/coupons", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_MANAGE), AdminGetCoupons);
router.get("/coupons/report", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_REPORTS), AdminCouponUsageReport);
router.get("/coupons/report/export", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_REPORTS), ExportCouponUsageReport);
router.post("/coupons", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_MANAGE), AdminCreateCoupon);
router.put("/coupons/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_MANAGE), AdminUpdateCoupon);
router.delete("/coupons/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.COUPONS_MANAGE), AdminDeleteCoupon);
router.post("/products/bulk-import", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_BULK), BulkImportProducts);
router.patch("/products/bulk-update", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_BULK), BulkUpdateProducts);
router.get("/products/export", isAdmin, requirePermission(ADMIN_PERMISSIONS.PRODUCTS_BULK), ExportProducts);
router.get("/reports/sales", isAdmin, requirePermission(ADMIN_PERMISSIONS.REPORTS_READ), GetSalesReport);
router.put("/homepage/settings", isAdmin, requirePermission(ADMIN_PERMISSIONS.CMS_MANAGE), UpdateHomepageSettings);
router.get("/cms/blocks", isAdmin, requirePermission(ADMIN_PERMISSIONS.CMS_MANAGE), AdminGetCmsBlocks);
router.post("/cms/blocks", isAdmin, requirePermission(ADMIN_PERMISSIONS.CMS_MANAGE), AdminCreateCmsBlock);
router.put("/cms/blocks/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.CMS_MANAGE), AdminUpdateCmsBlock);
router.delete("/cms/blocks/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.CMS_MANAGE), AdminDeleteCmsBlock);

export default router;
