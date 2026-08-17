import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import RevokedToken from "../../model/RevokedToken.model.js";

export const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

const getExpiryDate = (token) => {
  const decoded = jwt.decode(token);
  if (decoded?.exp) return new Date(decoded.exp * 1000);
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
};

export const revokeToken = async ({
  token,
  userId = null,
  tokenType = "access",
  reason = "",
}) => {
  if (!token) return null;

  return RevokedToken.findOneAndUpdate(
    { tokenHash: hashToken(token) },
    {
      $setOnInsert: {
        tokenHash: hashToken(token),
        user: userId,
        tokenType,
        expiresAt: getExpiryDate(token),
        reason,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
};

export const isTokenRevoked = async (token) => {
  if (!token) return false;
  const revoked = await RevokedToken.exists({ tokenHash: hashToken(token) });
  return Boolean(revoked);
};

