import mongoose from "mongoose";
import CouponModel from "./coupon.model.js";
import OrderModel from "../orders/Order.model.js";
import { EXCLUDE_AWAITING_PAYMENT } from "../orders/order-visibility.js";
import ProductModel from "../products/Product.model.js";

export const normalizeCouponId = (couponId = "") =>
  String(couponId || "").trim().toUpperCase();

export const couponError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getProductIdFromItem = (item = {}) =>
  item.product || item.productId || item.id || item._id;

const getQuantityFromItem = (item = {}) => Math.max(1, Number(item.quantity || item.qty || 1));

const getUserUsage = (coupon, userId) =>
  coupon.usedBy.find((usage) => String(usage.user) === String(userId));

/**
 * How many live orders this user has already placed with this coupon.
 *
 * A COUNT rather than the old boolean: with maxLimit now enforced as the
 * per-user allowance, "has used it at all" would still cap every coupon at one
 * use regardless of what the admin configured.
 */
const countOrdersWithCoupon = async ({ couponId, userId, session }) => {
  const query = {
    user: userId,
    coupon: normalizeCouponId(couponId),
    paymentStatus: { $ne: "Failed" },
    // An unpaid prepaid checkout is not a use. Without this, starting a Razorpay
    // checkout with a coupon and abandoning it would consume the customer's
    // allowance for a discount they never received.
    ...EXCLUDE_AWAITING_PAYMENT,
  };
  const lookup = OrderModel.countDocuments(query);
  if (session) lookup.session(session);
  return Number(await lookup) || 0;
};

const getCouponTargetType = (coupon) => {
  if ((!coupon.targetType || coupon.targetType === "all") && coupon.product_id && !coupon.category_id) {
    return "product";
  }
  if (coupon.targetType) return coupon.targetType;
  if (coupon.product_id) return "product";
  if (coupon.category_id) return "category";
  return "all";
};

const validateCouponDates = (coupon) => {
  const now = new Date();

  if (!coupon.isActive) {
    throw couponError("Coupon is not active");
  }

  if (coupon.startDate && coupon.startDate > now) {
    throw couponError("Coupon has not started yet");
  }

  if (coupon.expireDate && coupon.expireDate < now) {
    throw couponError("Coupon has expired");
  }
};

export const calculateCouponDiscount = async ({
  couponId,
  userId,
  items = [],
  redeem = false,
  session = null,
}) => {
  const normalizedCouponId = normalizeCouponId(couponId);
  if (!normalizedCouponId) {
    return { coupon: null, couponId: null, discount: 0, productId: null };
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw couponError("Invalid user for coupon");
  }

  const couponQuery = CouponModel.findOne({ couponId: normalizedCouponId });
  if (session) couponQuery.session(session);
  const coupon = await couponQuery;
  if (!coupon) {
    throw couponError("Invalid coupon code", 404);
  }

  validateCouponDates(coupon);

  if (coupon.assignedUser && String(coupon.assignedUser) !== String(userId)) {
    throw couponError("This coupon is assigned to another user");
  }

  // maxLimit is the PER-USER allowance. It was stored, editable in the admin UI,
  // reported on the coupons report — and read by nothing: the check here was
  // hardcoded to 1, so setting a coupon to "usable twice" had no effect at all.
  //
  // Read as per-user rather than as a global cap deliberately: the default is 1
  // and the hardcoded check it replaces was per-user, so every existing coupon
  // keeps exactly the behaviour it has today, while the two that are configured
  // for 2 uses start working as configured. A global cap would instead have
  // retroactively killed every coupon already used once.
  const perUserLimit = Math.max(1, Number(coupon.maxLimit) || 1);
  const usage = getUserUsage(coupon, userId);
  const usedCount = Number(usage?.count || 0);
  // Cross-checked against real orders as well as the counter, because the counter
  // is decremented on cancellation while the order history is the durable fact.
  const ordersWithCoupon = await countOrdersWithCoupon({
    couponId: normalizedCouponId,
    userId,
    session,
  });
  if (Math.max(usedCount, ordersWithCoupon) >= perUserLimit) {
    throw couponError(
      perUserLimit === 1
        ? "You have already used this coupon"
        : `You have already used this coupon the maximum ${perUserLimit} times`,
    );
  }

  const targetType = getCouponTargetType(coupon);
  const productIds = items
    .map(getProductIdFromItem)
    .filter((productId) => mongoose.Types.ObjectId.isValid(productId));

  if (productIds.length === 0) {
    throw couponError("Cart does not contain valid products");
  }

  const productFilter = { _id: { $in: productIds } };
  if (targetType === "product") {
    productFilter._id = coupon.product_id;
  }
  if (targetType === "category") {
    productFilter.category_id = coupon.category_id;
  }

  const productsQuery = ProductModel.find(productFilter).select("name price image brand category_id");
  if (session) productsQuery.session(session);
  const products = await productsQuery;
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  let eligibleQuantity = 0;
  let eligibleSubtotal = 0;
  const eligibleProductNames = [];

  for (const item of items) {
    const productId = String(getProductIdFromItem(item));
    const product = productMap.get(productId);
    if (!product) continue;

    const quantity = getQuantityFromItem(item);
    eligibleQuantity += quantity;
    eligibleSubtotal += (Number(product.price) || 0) * quantity;
    if (!eligibleProductNames.includes(product.name)) eligibleProductNames.push(product.name);
  }

  if (eligibleQuantity <= 0 || eligibleSubtotal <= 0) {
    throw couponError("Coupon is not valid for the products in this cart");
  }

  const minPurchaseAmount = Math.max(0, Number(coupon.minPurchaseAmount || 0));
  if (eligibleSubtotal < minPurchaseAmount) {
    throw couponError(
      `Eligible cart value must be at least Rs ${minPurchaseAmount} to use this coupon`,
    );
  }
  const maxPurchaseAmount = Math.max(0, Number(coupon.maxPurchaseAmount || 0));
  if (maxPurchaseAmount > 0 && eligibleSubtotal > maxPurchaseAmount) {
    throw couponError(
      `Eligible cart value must not exceed Rs ${maxPurchaseAmount} to use this coupon`,
    );
  }

  const rawDiscount =
    coupon.discountType === "percentage"
      ? Math.round((eligibleSubtotal * Number(coupon.discountValue || 0)) / 100)
      : Number(coupon.discountValue || 0);
  const discount = Math.min(eligibleSubtotal, Math.max(0, rawDiscount));

  if (discount <= 0) {
    throw couponError("Coupon does not provide a valid discount");
  }

  if (redeem) {
    if (usage) {
      usage.count = usedCount + 1;
      usage.lastUsedAt = new Date();
    } else {
      coupon.usedBy.push({
        user: userId,
        count: 1,
        lastUsedAt: new Date(),
      });
    }

    coupon.usage = coupon.usedBy.reduce((total, entry) => total + Number(entry.count || 0), 0);
    await coupon.save(session ? { session } : undefined);
  }

  return {
    coupon,
    couponId: coupon.couponId,
    discount,
    targetType,
    productId: targetType === "product" ? String(coupon.product_id) : null,
    categoryId: targetType === "category" ? String(coupon.category_id) : null,
    productName:
      targetType === "all"
        ? "All Products"
        : targetType === "category"
          ? "Selected Category"
          : eligibleProductNames[0],
    eligibleProductNames,
    eligibleQuantity,
    minPurchaseAmount,
    eligibleSubtotal,
    remainingUses: Math.max(0, perUserLimit - usedCount - (redeem ? 1 : 0)),
  };
};
