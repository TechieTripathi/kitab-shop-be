import Product from "../products/Product.model.js";
import Category from "../categories/Category.model.js";
import Cart from "../cart/cart.model.js";
import Wishlist from "../wishlist/Wishlist.model.js";
import UserAuthentication from "../../model/User.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import EmailVerification from "../../model/emailverification.model.js";
import Order from "../orders/Order.model.js";
import { EXCLUDE_AWAITING_PAYMENT } from "../orders/order-visibility.js";
import { NON_REVENUE_STATUSES } from "../orders/order-status.rules.js";
import InventorySetting from "../inventory/InventorySetting.model.js";
import { buildLast7Days, dateRange } from "./admin-response.service.js";

export const buildDashboardData = async () => {
  const last7Days = buildLast7Days();
  const last7DaysStart = new Date(last7Days[0].key);
  const { lowStockThreshold } = await InventorySetting.getSettings();

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
    // Excludes prepaid checkouts that were never paid for — they are rows in
    // `orders`, but they are not orders. See order-visibility.js.
    Order.countDocuments(EXCLUDE_AWAITING_PAYMENT),

    Order.aggregate([
      {
        $match: {
          // "Closed" joins "Cancelled": an RTO that came back and was closed out
          // is not a sale. It used to close out AS "Cancelled", so it was excluded
          // by accident; now that it has its own status the exclusion has to be
          // explicit or every closed RTO would start counting as revenue.
          orderStatus: { $nin: NON_REVENUE_STATUSES },
          // Without this an abandoned checkout counts as revenue.
          ...EXCLUDE_AWAITING_PAYMENT,
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
        },
      },
    ]),

    // ── STOCK COMES FROM THE PRODUCT (audit H2-09) ───────────────────────────
    // This aggregated `InventoryModel`, which no order, cancellation, return, RTO
    // or reservation path has ever written — `product.stock` is what those paths
    // move, atomically, via $inc. The two therefore diverged from the first sale
    // onwards, and in the live database they had diverged completely: 17 inventory
    // rows, all of them orphaned, reporting 873 units against a real catalogue
    // total of 7882.
    //
    // Reads `product.stock` instead. Deliberately NOT the other direction — nothing
    // synchronises InventoryModel from the order paths, because that would put a
    // second, non-atomic ledger write inside every stock movement.
    //
    // The in/out-of-stock RULE is carried over unchanged, not redefined: it was
    // `status === "Out of Stock"`, and InventoryModel derives that field in a
    // pre-save hook as `stock === 0 ? "Out of Stock" : "In Stock"`. So "out of
    // stock" still means exactly `stock === 0`, and everything else is in stock.
    Product.aggregate([
      {
        $group: {
          _id: null,
          totalStock: { $sum: "$stock" },
          inStock: {
            $sum: {
              $cond: [{ $eq: ["$stock", 0] }, 0, 1],
            },
          },
          outOfStock: {
            $sum: {
              $cond: [{ $eq: ["$stock", 0] }, 1, 0],
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

    // The reorder signal, and the part of H2-09 that could actually cost money.
    //
    // This matched `InventoryModel.stock <= lowStockThreshold`, so a product sold
    // down to zero never appeared here — its inventory row still held whatever it
    // was seeded with. In the live database the list came back EMPTY while six
    // products were at or below the threshold: the operator was never told to
    // reorder anything.
    //
    // Same threshold, from the same place (InventorySetting.getSettings() above) —
    // no new threshold, and no new configuration. The $lookup is gone because the
    // product IS the source now, and `status` is computed with InventoryModel's own
    // rule so the field keeps its existing meaning. Output shape is unchanged:
    // { productId, productName, brand, image, stock, status }.
    Product.aggregate([
      {
        $match: {
          stock: { $lte: lowStockThreshold },
        },
      },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          productName: "$name",
          brand: "$brand",
          image: "$image",
          stock: 1,
          status: {
            $cond: [{ $eq: ["$stock", 0] }, "Out of Stock", "In Stock"],
          },
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
          // A closed RTO must not appear as revenue on the chart either.
          //
          // Deliberately excluding "Closed" ONLY, not the whole NON_REVENUE set:
          // this aggregate has never excluded "Cancelled", so cancelled orders are
          // counted here today while being excluded from totalRevenue above. That
          // inconsistency is pre-existing and changing it would alter established
          // "Cancelled" reporting, which was out of scope for this change — it is
          // reported separately rather than fixed silently.
          orderStatus: { $ne: "Closed" },
          ...EXCLUDE_AWAITING_PAYMENT,
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

    Order.find(EXCLUDE_AWAITING_PAYMENT)
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
    // Shared by the by-date, by-product, by-category and by-customer aggregates
    // below, so one exclusion covers all four.
    orderStatus: { $nin: NON_REVENUE_STATUSES },
    ...EXCLUDE_AWAITING_PAYMENT,
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
