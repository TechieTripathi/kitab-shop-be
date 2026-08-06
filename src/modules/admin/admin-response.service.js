import mongoose from "mongoose";
import Order from "../orders/Order.model.js";
import UserAuthentication from "../../model/User.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import {
  ADMIN_ROLES,
  getPrimaryRole,
  getUserPermissions,
  normalizeRoles,
} from "../../config/admin-permissions.config.js";

export const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const sendCsv = (res, filename, rows) => {
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
};

export const buildLast7Days = () => {
  const days = [];

  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);

    days.push({
      key: date.toISOString().slice(0, 10),
      day: date.toLocaleDateString("en-IN", { weekday: "short" }),
    });
  }

  return days;
};

const formatUserProfile = (profile) => {
  if (!profile) return null;

  return {
    fullName: profile.fullName || "",
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    phoneNumber: profile.phoneNumber || "",
    city: profile.address?.city || "",
    state: profile.address?.state || "",
  };
};

export const formatAdminUser = ({ user, profile, ordersCount = 0 }) => ({
  _id: user._id,
  id: user._id,
  email: user.email,
  role: getPrimaryRole(user),
  roles: normalizeRoles(user),
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  effectivePermissions: getUserPermissions(user),
  isVerified: Boolean(user.isVerified),
  isActive: user.isActive !== false && user.isBlocked !== true,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  ordersCount,
  walletBalance: profile?.walletBalance || 0,
  totalReferrals: profile?.totalReferrals || 0,
  referralCode: profile?.referralCode || "",
  profile: formatUserProfile(profile),
});

export const setUserActiveStatus = async ({ id, isActive, adminId }) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Invalid user id");
    error.statusCode = 400;
    throw error;
  }

  if (String(id) === String(adminId)) {
    const error = new Error("You cannot change your own account status");
    error.statusCode = 403;
    throw error;
  }

  const user = await UserAuthentication.findById(id).select("-password -Resettoken");

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (normalizeRoles(user).some((role) => ADMIN_ROLES.includes(role))) {
    const error = new Error("Admin accounts cannot be blocked");
    error.statusCode = 403;
    throw error;
  }

  user.isActive = isActive;
  user.isBlocked = !isActive;
  user.blockedAt = isActive ? null : new Date();
  await user.save();

  const [profile, ordersCount] = await Promise.all([
    UserProfile.findOne({ userid: user._id }),
    Order.countDocuments({ user: user._id }),
  ]);

  return formatAdminUser({ user, profile, ordersCount });
};

export const normalizeBulkProduct = (item = {}) => ({
  name: String(item.name || "").trim(),
  description: String(item.description || "").trim(),
  price: Number(item.price),
  mrp: item.mrp === undefined || item.mrp === "" ? Number(item.price) : Number(item.mrp),
  category_id: item.category_id || item.categoryId,
  size: item.size || "Standard",
  brand: String(item.brand || "").trim(),
  stock: Number(item.stock || 0),
  producthightlight: String(item.producthightlight || item.highlight || "").trim(),
  image: String(item.image || "").trim(),
  public_id: item.public_id || "",
  bestseller: Boolean(item.bestseller),
});

export const dateRange = (query = {}) => {
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = query.to ? new Date(query.to) : new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to || ""))) to.setHours(23, 59, 59, 999);
  return { from, to };
};
