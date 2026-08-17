import UserModel from "../model/User.model.js";
import {
  getPrimaryRole,
  getUserPermissions,
  hasAdminRole,
  normalizeRoles,
} from "../config/admin-permissions.config.js";

export const requirePermission = (permission) => async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user?.id).select(
      "roles permissions isActive isBlocked",
    );

    // hasAdminRole as well as the permission: this middleware only ever checked
    // the permission set, so a plain `user` who was granted an individual
    // permission (directly, or by a future bug in the permissions editor) passed
    // every admin route it guards. A permission is meant to narrow admin access,
    // never to confer it.
    if (!user || user.isActive === false || user.isBlocked || !hasAdminRole(user)) {
      return res.status(403).json({ success: false, message: "Admin access denied" });
    }

    const permissions = new Set(getUserPermissions(user));

    if (!permissions.has(permission)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    req.user.role = getPrimaryRole(user);
    req.user.roles = normalizeRoles(user);
    req.user.permissions = [...permissions];
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
