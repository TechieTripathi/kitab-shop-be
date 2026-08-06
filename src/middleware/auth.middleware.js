import jwt from "jsonwebtoken";
import { isAuthSecurityEnabled } from "../config/features.config.js";
import { getPrimaryRole, normalizeRoles } from "../config/admin-permissions.config.js";
import UserModel from "../model/User.model.js";
import { isTokenRevoked } from "../modules/auth/token-revocation.service.js";

export const TokenVerify = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Token is required",
      });
    }
    const token = authHeader.split(" ")[1];
    if (isAuthSecurityEnabled() && (await isTokenRevoked(token))) {
      return res.status(401).json({
        message: "Token has been revoked",
      });
    }

    const decoded = jwt.verify(token, process.env.acess_token);
    const user = await UserModel.findById(decoded.id).select(
      "roles isActive isBlocked",
    );

    if (!user) {
      return res.status(401).json({ message: "Account no longer exists" });
    }

    if (user.isBlocked || user.isActive === false) {
      return res.status(403).json({
        message: "Your account is blocked. Please contact support.",
      });
    }

    const roles = normalizeRoles(user);
    req.user = {
      ...decoded,
      id: String(user._id),
      role: getPrimaryRole(user),
      roles,
    };
    req.authToken = token;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
