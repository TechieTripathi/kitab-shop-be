import express from "express";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";
import {
  getReferralSettings,
  updateReferralSettings,
  getReferralStats,
  getReferralDetails,
  deleteReferrerRecord,
  deleteDiscountRecord
} from "./referral.controller.js";

const router = express.Router();

router.get("/admin/settings", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), getReferralSettings);
router.put("/admin/settings", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), updateReferralSettings);
router.get("/admin/stats", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), getReferralStats);
router.get("/admin/details", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), getReferralDetails);
router.delete("/admin/referrer/:id", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), deleteReferrerRecord);
router.delete("/admin/discount/:id", TokenVerify, isAdmin, requirePermission(ADMIN_PERMISSIONS.REFERRALS_MANAGE), deleteDiscountRecord);

export default router;
