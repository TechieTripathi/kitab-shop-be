import Product from "../products/Product.model.js";
import Category from "../categories/Category.model.js";
import Inventory from "../inventory/inventory.model.js";
import Cart from "../cart/cart.model.js";
import Wishlist from "../wishlist/Wishlist.model.js";
import UserAuthentication from "../../model/User.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import EmailVerification from "../../model/emailverification.model.js";
import Order from "../orders/Order.model.js";
import { getFeatures } from "../../config/features.config.js";
import { buildLast7Days, dateRange } from "./admin-response.service.js";

export const buildDashboardData = async () => {
  const last7Days = buildLast7Days();
  const last7DaysStart = new Date(last7Days[0].key);

  const [
    totalProducts,
    totalCategories,
    totalUsers,
    totalProfiles,
    totalWishlist,
    totalCart,
    totalPendingVerification,
    totalVerifiedUsers,
    totalOrders,
    revenueSummary,
    inventorySummary,
    productsByCategory,
    lowStockProducts,
    recentUsers,
    ordersLast7DaysRaw,
    recentOrders,
    referralStatsRaw,
  ] = await Promise.all([
    Product.countDocuments(),
    Category.countDocuments(),
    UserAuthentication.countDocuments(),
    UserProfile.countDocuments(),
    Wishlist.countDocuments(),
    Cart.countDocuments(),
    EmailVerification.countDocuments({ isUsed: false }),
    UserAuthentication.countDocuments({ isVerified: true }),
    Order.countDocuments(),

    Order.aggregate([
      {
        $match: {
          orderStatus: { $ne: "Cancelled" },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
        },
      },
    ]),

    Inventory.aggregate([
      {
        $group: {
          _id: null,
          totalStock: { $sum: "$stock" },
          inStock: {
            $sum: {
              $cond: [{ $eq: ["$status", "In Stock"] }, 1, 0],
            },
          },
          outOfStock: {
            $sum: {
              $cond: [{ $eq: ["$status", "Out of Stock"] }, 1, 0],
            },
          },
        },
      },
    ]),

    Product.aggregate([
      {
        $group: {
          _id: "$category_id",
          totalProducts: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: Category.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $unwind: {
          path: "$category",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          categoryId: "$_id",
          category: { $ifNull: ["$category.name", "Uncategorized"] },
          totalProducts: 1,
        },
      },
      {
        $group: {
          _id: "$category",
          totalProducts: { $sum: "$totalProducts" },
        },
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          totalProducts: 1,
        },
      },
      {
        $sort: { totalProducts: -1 },
      },
    ]),

    Inventory.aggregate([
      {
        $match: {
          stock: { $lte: getFeatures().inventory.lowStockThreshold },
        },
      },
      {
        $lookup: {
          from: Product.collection.name,
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $unwind: "$product",
      },
      {
        $project: {
          _id: 0,
          productId: "$product._id",
          productName: "$product.name",
          brand: "$product.brand",
          image: "$product.image",
          stock: 1,
          status: 1,
        },
      },
      {
        $sort: { stock: 1 },
      },
      {
        $limit: 10,
      },
    ]),

    UserAuthentication.find()
      .select("email roles isVerified isActive createdAt")
      .sort({ createdAt: -1 })
      .limit(5),

    Order.aggregate([
      {
        $match: {
          createdAt: { $gte: last7DaysStart },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "Asia/Kolkata",
            },
          },
          orders: { $sum: 1 },
          revenue: { $sum: "$totalAmount" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]),

    Order.find()
      .populate("user", "email roles")
      .select("user items totalAmount orderStatus paymentStatus paymentMethod shippingAddress createdAt")
      .sort({ createdAt: -1 })
      .limit(5),

    UserProfile.aggregate([
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: "$totalReferrals" },
          totalWalletCreditEarned: { $sum: "$totalWalletCreditEarned" },
        },
      },
    ]),
  ]);

  const orderMap = new Map(
    ordersLast7DaysRaw.map((item) => [
      item._id,
      {
        orders: item.orders,
        revenue: item.revenue,
      },
    ]),
  );

  const ordersLast7Days = last7Days.map((day) => ({
    day: day.day,
    date: day.key,
    orders: orderMap.get(day.key)?.orders || 0,
  }));

  const revenueLast7Days = last7Days.map((day) => ({
    day: day.day,
    date: day.key,
    revenue: orderMap.get(day.key)?.revenue || 0,
  }));

  return {
    cards: {
      totalProducts,
      totalCategories,
      totalUsers,
      totalProfiles,
      totalWishlist,
      totalCart,
      verifiedUsers: totalVerifiedUsers,
      pendingEmailVerification: totalPendingVerification,
      totalOrders,
      totalRevenue: revenueSummary[0]?.totalRevenue || 0,
      totalReferrals: referralStatsRaw[0]?.totalReferrals || 0,
      totalWalletCreditIssued: referralStatsRaw[0]?.totalWalletCreditEarned || 0,
      averageRating: 0,
    },

    inventory: inventorySummary[0] || {
      totalStock: 0,
      inStock: 0,
      outOfStock: 0,
    },

    charts: {
      productsByCategory,
      ordersLast7Days,
      revenueLast7Days,
    },

    tables: {
      lowStockProducts,
      recentUsers,
      recentOrders: recentOrders.map((order) => ({
        id: order._id,
        userEmail: order.user?.email || "",
        userName: order.shippingAddress?.fullName || "",
        itemsCount: order.items?.length || 0,
        totalAmount: order.totalAmount,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
      })),
    },
  };
};

export const buildSalesReportData = async (query = {}) => {
  const { from, to } = dateRange(query);
  const match = {
    createdAt: { $gte: from, $lte: to },
    orderStatus: { $ne: "Cancelled" },
  };

  const [byDate, byProduct, byCategory, byCustomer] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$totalAmount" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          productName: { $first: "$items.name" },
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 50 },
    ]),
    Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $lookup: {
          from: Product.collection.name,
          localField: "items.product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: Category.collection.name,
          localField: "product.category_id",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$category._id",
          categoryName: { $first: { $ifNull: ["$category.name", "Uncategorized"] } },
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$user",
          orders: { $sum: 1 },
          revenue: { $sum: "$totalAmount" },
          lastOrderAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: UserAuthentication.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: "$_id",
          email: "$user.email",
          orders: 1,
          revenue: 1,
          lastOrderAt: 1,
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 50 },
    ]),
  ]);

  return {
    range: { from, to },
    data: { byDate, byProduct, byCategory, byCustomer },
  };
};
