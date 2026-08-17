import jwt from "jsonwebtoken";
import { isAuthSecurityEnabled } from "../config/features.config.js";
import {
  getPrimaryRole,
  hasAdminRole,
  normalizeRoles,
} from "../config/admin-permissions.config.js";
import UserModel from "../model/User.model.js";
import { isTokenRevoked } from "../modules/auth/token-revocation.service.js";

export const isAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Token is required",
      });
    }
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;
    if (isAuthSecurityEnabled() && (await isTokenRevoked(token))) {
      return res.status(401).json({
        message: "Token has been revoked",
      });
    }

    const decoded = jwt.verify(token, process.env.acess_token);

    if (!hasAdminRole(decoded)) {
      return res.status(403).json({
        message: "You are not allowed to access admin routes",
      });
    }

    // isBlocked is checked here as well as isActive. TokenVerify (the customer
    // path) already rejected blocked accounts, but this middleware did not even
    // select the field — so blocking a compromised or departed admin left their
    // existing token fully valid on every admin route until it expired.
    const user = await UserModel.findById(decoded.id).select(
      "roles isActive isBlocked",
    );

    if (!user || !hasAdminRole(user) || user.isActive === false || user.isBlocked) {
      return res.status(403).json({
        message: "Admin access denied",
      });
    }

    req.user = {
      ...decoded,
      role: getPrimaryRole(user),
      roles: normalizeRoles(user),
    };
    req.authToken = token;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
