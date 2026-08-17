import UserModel from "../model/User.model.js";
import { getUserPermissions, hasAdminRole } from "./admin-permissions.config.js";

/**
 * Does this caller actually hold `permission`?
 *
 * Several customer-facing endpoints let a non-owner through on the strength of
 * `hasAdminRole(req.user)` alone. That is a role-tier check, not a permission
 * check: `themeEditor` — an account provisioned to edit banners and CMS copy —
 * passed it, which meant it could read any order and any return request. Return
 * requests carry `refundDestination` (UPI id, account number, IFSC), so the
 * weakest admin role could enumerate customer bank details.
 *
 * This reads the CURRENT stored roles/permissions rather than trusting the JWT
 * claims, so revoking a permission takes effect immediately instead of at token
 * expiry, and it re-checks isActive/isBlocked for the same reason.
 */
export const adminHasPermission = async (reqUser, permission) => {
  if (!reqUser?.id || !hasAdminRole(reqUser)) return false;

  // Already resolved by requirePermission earlier in the chain — no second read.
  if (Array.isArray(reqUser.permissions)) {
    return reqUser.permissions.includes(permission);
  }

  const user = await UserModel.findById(reqUser.id).select(
    "roles permissions isActive isBlocked",
  );
  if (!user || user.isActive === false || user.isBlocked) return false;

  return getUserPermissions(user).includes(permission);
};
