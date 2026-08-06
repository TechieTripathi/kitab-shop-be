import Product from "../products/Product.model.js";
import UserAuthentication from "../../model/User.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import Order from "../orders/Order.model.js";
import mongoose from "mongoose";
import {
  ADMIN_PERMISSIONS,
  ROLE_PERMISSIONS,
  VALID_USER_ROLES,
  getRolePermissions,
} from "../../config/admin-permissions.config.js";
import { createAuditLog } from "../audit/audit-log.js";
import {
  formatAdminUser,
  normalizeBulkProduct,
  sendCsv,
  setUserActiveStatus,
} from "./admin-response.service.js";
import {
  buildDashboardData,
  buildSalesReportData,
} from "./admin-report.service.js";

export const GetDashboard = async (req, res) => {
  try {
    const dashboard = await buildDashboardData();
    return res.status(200).json({ success: true, dashboard });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetAdminPermissions = async (req, res) =>
  res.status(200).json({
    success: true,
    permissions: ADMIN_PERMISSIONS,
    rolePermissions: Object.fromEntries(
      Object.keys(ROLE_PERMISSIONS).map((role) => [role, getRolePermissions(role)]),
    ),
  });

export const UpdateUserPermissions = async (req, res) => {
  try {
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : null;
    const validPermissions = new Set(Object.values(ADMIN_PERMISSIONS));
    const invalid = permissions.filter((permission) => !validPermissions.has(permission));
    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid permissions: ${invalid.join(", ")}`,
      });
    }

    const update = { permissions };
    if (roles) {
      const normalizedRoles = [...new Set(roles.map((role) => String(role).trim()).filter(Boolean))];
      const invalidRoles = normalizedRoles.filter((role) => !VALID_USER_ROLES.includes(role));
      if (invalidRoles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid roles: ${invalidRoles.join(", ")}`,
        });
      }

      update.roles = normalizedRoles.length > 0 ? normalizedRoles : ["user"];
    }

    const user = await UserAuthentication.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true },
    ).select("-password -Resettoken");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await createAuditLog({
      admin: req.user?.id,
      action: "UPDATE_PERMISSIONS",
      module: "USER",
      targetId: user._id,
      targetName: user.email,
      description: `Updated permissions for ${user.email}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Permissions updated",
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetAllUsers = async (req, res) => {
  try {
    const { search = "", role = "all", status = "all" } = req.query;
    const filter = {};

    if (role !== "all") {
      filter.roles = role;
    }
    if (status === "active") filter.isActive = { $ne: false };
    if (status === "blocked") filter.isActive = false;

    if (search.trim()) {
      filter.email = {
        $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    const users = await UserAuthentication.find(filter)
      .select("-password -Resettoken")
      .sort({ createdAt: -1 });

    const userIds = users.map((user) => user._id);

    const [profiles, orderCounts] = await Promise.all([
      UserProfile.find({ userid: { $in: userIds } }),
      Order.aggregate([
        {
          $match: {
            user: { $in: userIds },
          },
        },
        {
          $group: {
            _id: "$user",
            ordersCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const profilesByUser = new Map(
      profiles.map((profile) => [String(profile.userid), profile]),
    );
    const ordersByUser = new Map(
      orderCounts.map((item) => [String(item._id), item.ordersCount]),
    );

    const result = users.map((user) =>
      formatAdminUser({
        user,
        profile: profilesByUser.get(String(user._id)),
        ordersCount: ordersByUser.get(String(user._id)) || 0,
      }),
    );

    return res.status(200).json({
      success: true,
      totalUsers: result.length,
      users: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const BlockUser = async (req, res) => {
  try {
    const user = await setUserActiveStatus({
      id: req.params.id,
      isActive: false,
      adminId: req.user?.id,
    });

    await createAuditLog({
      admin: req.user?.id,
      action: "BLOCK_USER",
      module: "USER",
      targetId: user.id,
      targetName: user.email,
      description: `Blocked user ${user.email}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "User blocked successfully",
      user,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

export const UnBlockUser = async (req, res) => {
  try {
    const user = await setUserActiveStatus({
      id: req.params.id,
      isActive: true,
      adminId: req.user?.id,
    });

    await createAuditLog({
      admin: req.user?.id,
      action: "UNBLOCK_USER",
      module: "USER",
      targetId: user.id,
      targetName: user.email,
      description: `Unblocked user ${user.email}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully",
      user,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

export const BulkImportProducts = async (req, res) => {
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    if (products.length === 0) {
      return res.status(400).json({ success: false, message: "Products array is required" });
    }

    const errors = [];
    const payload = [];
    products.forEach((item, index) => {
      const product = normalizeBulkProduct(item);
      const missing = [];
      if (!product.name) missing.push("name");
      if (!product.description) missing.push("description");
      if (!Number.isFinite(product.price) || product.price < 0) missing.push("price");
      if (!product.category_id || !mongoose.Types.ObjectId.isValid(product.category_id)) {
        missing.push("category_id");
      }
      if (!product.brand) missing.push("brand");
      if (!Number.isInteger(product.stock) || product.stock < 0) missing.push("stock");
      if (!product.producthightlight) missing.push("producthightlight");
      if (!product.image) missing.push("image");

      if (missing.length > 0) {
        errors.push({ index, message: `Invalid fields: ${missing.join(", ")}` });
      } else {
        payload.push(product);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const created = await Product.insertMany(payload, { ordered: false });
    await createAuditLog({
      admin: req.user?.id,
      action: "BULK_IMPORT_PRODUCTS",
      module: "PRODUCT",
      description: `Imported ${created.length} products`,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Products imported",
      count: created.length,
      data: created,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const ExportProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate("category_id", "name")
      .sort({ createdAt: -1 })
      .lean();

    const rows = [
      ["id", "name", "brand", "category", "price", "mrp", "stock", "bestseller", "createdAt"],
      ...products.map((product) => [
        product._id,
        product.name,
        product.brand,
        product.category_id?.name || "",
        product.price,
        product.mrp,
        product.stock,
        product.bestseller,
        product.createdAt?.toISOString?.() || "",
      ]),
    ];

    return sendCsv(res, "products-export.csv", rows);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const BulkUpdateProducts = async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "Updates array is required" });
    }

    const operations = [];
    for (const item of updates) {
      const productId = item.productId || item._id || item.id;
      if (!mongoose.Types.ObjectId.isValid(productId)) continue;

      const $set = {};
      if (item.price !== undefined) {
        const price = Number(item.price);
        if (Number.isFinite(price) && price >= 0) $set.price = price;
      }
      if (item.mrp !== undefined) {
        const mrp = Number(item.mrp);
        if (Number.isFinite(mrp) && mrp >= 0) $set.mrp = mrp;
      }
      if (item.stock !== undefined) {
        const stock = Number(item.stock);
        if (Number.isInteger(stock) && stock >= 0) $set.stock = stock;
      }
      if (item.bestseller !== undefined) $set.bestseller = Boolean(item.bestseller);

      if (Object.keys($set).length > 0) {
        operations.push({
          updateOne: {
            filter: { _id: productId },
            update: { $set },
          },
        });
      }
    }

    if (operations.length === 0) {
      return res.status(400).json({ success: false, message: "No valid updates provided" });
    }

    const result = await Product.bulkWrite(operations);
    await createAuditLog({
      admin: req.user?.id,
      action: "BULK_UPDATE_PRODUCTS",
      module: "PRODUCT",
      description: `Bulk updated ${result.modifiedCount} products`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Products updated",
      result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetSalesReport = async (req, res) => {
  try {
    const report = await buildSalesReportData(req.query);
    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
