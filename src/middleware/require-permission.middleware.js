import UserModel from "../model/User.model.js";
import {
  getPrimaryRole,
  getUserPermissions,
  normalizeRoles,
} from "../config/admin-permissions.config.js";

export const requirePermission = (permission) => async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user?.id).select(
      "roles permissions isActive isBlocked",
    );

    if (!user || user.isActive === false || user.isBlocked) {
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
