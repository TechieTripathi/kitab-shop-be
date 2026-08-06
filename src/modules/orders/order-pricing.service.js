import mongoose from "mongoose";
import { isStockEnforced } from "../../config/features.config.js";
import ProductModel from "../products/Product.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import { calculateCouponDiscount } from "../coupons/coupon.service.js";
import { getVariantKey } from "../inventory/inventory-reservation.service.js";

export const orderError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const normalizeShippingAddress = (address = {}) => ({
  fullName: address.fullName || address.name || "",
  phone: address.phone || address.mobile || "",
  address: address.address || address.line || address.addressLine1 || "",
  city: address.city || "",
  state: address.state || "",
  pincode: address.pincode || "",
  country: address.country || "India",
});

const validateShippingAddress = (shippingAddress) => {
  const missingFields = [];
  if (!shippingAddress.fullName?.trim()) missingFields.push("fullName");
  if (!shippingAddress.phone?.trim()) missingFields.push("phone");
  if (!shippingAddress.address?.trim()) missingFields.push("address");
  if (!shippingAddress.city?.trim()) missingFields.push("city");
  if (!shippingAddress.state?.trim()) missingFields.push("state");
  if (!shippingAddress.pincode?.trim()) missingFields.push("pincode");
  return missingFields;
};

export const prepareOrderData = async ({
  items = [],
  rawShippingAddress,
  coupon = null,
  userId,
  redeemCoupon = false,
  useWallet = false,
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw orderError("Order must contain at least one item");
  }

  const shippingAddress = normalizeShippingAddress(rawShippingAddress);
  const missingAddressFields = validateShippingAddress(shippingAddress);
  if (missingAddressFields.length > 0) {
    throw orderError(`Missing shipping fields: ${missingAddressFields.join(", ")}`);
  }
  if (!/^[6-9][0-9]{9}$/.test(shippingAddress.phone)) {
    throw orderError("Enter a valid 10-digit Indian mobile number");
  }
  if (!/^[1-9][0-9]{5}$/.test(shippingAddress.pincode)) {
    throw orderError("Enter a valid 6-digit Indian PIN code");
  }

  const orderItems = [];
  let subtotal = 0;

  for (const item of items) {
    const productId = item.product || item.productId || item.id || item._id;
    const quantity = Number(item.quantity || item.qty || 1);
    const selectedVariants =
      item.selectedVariants && typeof item.selectedVariants === "object"
        ? item.selectedVariants
        : {};
    const variantKey = item.variantKey || getVariantKey(selectedVariants);

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw orderError(
        "Invalid product id in cart. Please remove this item and add it again.",
      );
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw orderError("Invalid product quantity");
    }

    const product = await ProductModel.findById(productId).select(
      "name image price stock",
    );
    if (!product) throw orderError("Product not found", 404);
    if (isStockEnforced() && product.stock < quantity) {
      throw orderError(`${product.name} has only ${product.stock} item(s) in stock`);
    }

    const price = Number(product.price) || 0;
    orderItems.push({
      product: product._id,
      name: product.name,
      image: product.image || "",
      price,
      quantity,
      selectedVariants,
      variantKey,
    });
    subtotal += price * quantity;
  }

  const couponResult = coupon
    ? await calculateCouponDiscount({
        couponId: coupon,
        userId,
        items,
        redeem: redeemCoupon,
      })
    : null;
  const couponDiscount = Math.min(subtotal, Math.max(0, Number(couponResult?.discount) || 0));
  
  let walletDiscount = 0;
  if (useWallet && userId) {
    const userProfile = await UserProfile.findOne({ userid: userId });
    const availableWalletBalance = userProfile?.walletBalance || 0;
    
    // Wallet discount can cover whatever is left after coupon discount, up to the available balance
    const remainingSubtotal = Math.max(0, subtotal - couponDiscount);
    walletDiscount = Math.min(availableWalletBalance, remainingSubtotal);
  }

  const discount = couponDiscount + walletDiscount;
  const shippingCharge = 0;
  const tax = 0;

  return {
    orderItems,
    shippingAddress,
    subtotal,
    shippingCharge,
    tax,
    discount,
    couponDiscount,
    walletDiscount,
    totalAmount: Math.max(0, subtotal + shippingCharge + tax - discount),
    couponId: couponResult?.couponId || null,
  };
};
