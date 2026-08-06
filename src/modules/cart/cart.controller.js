import mongoose from "mongoose";
import { isStockEnforced } from "../../config/features.config.js";
import cartModel from "./cart.model.js";
import ProductModel from "../products/Product.model.js";
import { notifyAbandonedCart } from "../notifications/notification.service.js";
import { hasAdminRole } from "../../config/admin-permissions.config.js";

const ADMIN_PURCHASE_MESSAGE =
  "Admin accounts cannot add products to cart or place orders. Please use a customer account.";
const CART_PRODUCT_SELECT = "name image price mrp brand category_id stock";

const assertCustomerCanPurchase = (user = {}) => {
  if (hasAdminRole(user)) {
    const error = new Error(ADMIN_PURCHASE_MESSAGE);
    error.status = 403;
    throw error;
  }
};

const normalizeSelectedVariants = (selectedVariants = {}) => {
  if (!selectedVariants || typeof selectedVariants !== "object") return {};

  return Object.entries(selectedVariants).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      acc[key] = String(value);
    }
    return acc;
  }, {});
};

const buildVariantKey = (selectedVariants = {}) =>
  Object.keys(selectedVariants)
    .sort()
    .map((key) => `${key}:${selectedVariants[key]}`)
    .join("|");

const getProductId = (item = {}) => item.productId || item.product || item.id || item._id;

const getOrCreateCart = async (userId) => {
  let cart = await cartModel.findOne({ user: userId });

  if (!cart) {
    cart = await cartModel.create({
      user: userId,
      items: [],
    });
  }

  return cart;
};

// Cart items snapshot price/mrp when added so the line total stays stable
// while shopping. Reconcile that snapshot against the live product price on
// every read: correct the stored value so it never drifts further from what
// checkout will actually charge (order-pricing.service.js always re-prices
// from the live product regardless), and flag the change so the UI can tell
// the customer what happened instead of silently showing a stale number.
const populateCart = async (cart) => {
  await cart.populate({
    path: "items.product",
    select: CART_PRODUCT_SELECT,
    populate: { path: "category_id", select: "name" },
  });

  let priceDrifted = false;
  const items = cart.items.map((item) => {
    const product = item.product;
    const previousPrice = Number(item.price) || 0;
    const livePrice = product ? Number(product.price) || 0 : previousPrice;
    const priceChanged = Boolean(product) && livePrice !== previousPrice;

    if (priceChanged) {
      priceDrifted = true;
      item.price = livePrice;
      item.mrp = product.mrp !== undefined ? Number(product.mrp) || livePrice : livePrice;
    }

    return {
      ...item.toObject(),
      priceChanged,
      previousPrice: priceChanged ? previousPrice : undefined,
    };
  });

  if (priceDrifted) {
    await cart.save();
  }

  return { ...cart.toObject(), items };
};

const findCartItem = (cart, { cartItemId, productId, variantKey = "" }) => {
  if (cartItemId) {
    return cart.items.find((item) => item._id.toString() === String(cartItemId));
  }

  return cart.items.find(
    (item) =>
      item.product.toString() === String(productId) &&
      String(item.variantKey || "") === String(variantKey || ""),
  );
};

const validateProductId = (productId) => {
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    const error = new Error("Invalid product id");
    error.status = 400;
    throw error;
  }
};

const addItemsToCart = async (userId, items) => {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("Items are required");
    error.status = 400;
    throw error;
  }

  const cart = await getOrCreateCart(userId);

  for (const item of items) {
    const productId = getProductId(item);
    const quantity = Number(item.quantity ?? item.qty ?? 1);
    const selectedVariants = normalizeSelectedVariants(item.selectedVariants);
    const variantKey = buildVariantKey(selectedVariants);

    validateProductId(productId);

    if (!Number.isInteger(quantity) || quantity < 1) {
      const error = new Error("Quantity must be a positive whole number");
      error.status = 400;
      throw error;
    }

    const product = await ProductModel.findById(productId).select(
      "name price mrp stock",
    );
    if (!product) {
      const error = new Error("Product not found");
      error.status = 404;
      throw error;
    }

    const existingItem = findCartItem(cart, { productId, variantKey });
    const nextQuantity = (existingItem?.quantity || 0) + quantity;

    if (isStockEnforced() && product.stock < nextQuantity) {
      const error = new Error(`${product.name} has only ${product.stock} item(s) in stock`);
      error.status = 400;
      error.code = "INSUFFICIENT_STOCK";
      error.details = {
        productId: String(product._id),
        availableStock: product.stock,
        quantityInCart: existingItem?.quantity || 0,
        requestedQuantity: nextQuantity,
      };
      throw error;
    }

    const itemPrice = Number(product.price) || 0;
    const itemMrp = Number(product.mrp ?? itemPrice) || itemPrice;

    if (existingItem) {
      existingItem.quantity = nextQuantity;
      existingItem.price = itemPrice;
      existingItem.mrp = itemMrp;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        selectedVariants,
        variantKey,
        price: itemPrice,
        mrp: itemMrp,
      });
    }
  }

  await cart.save();
  return populateCart(cart);
};

export const addToCart = async (req, res) => {
  try {
    assertCustomerCanPurchase(req.user);
    const cart = await addItemsToCart(req.user.id, req.body.items);

    return res.status(200).json({
      success: true,
      message: "Items added successfully",
      data: cart,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }
};

export const singleProduct = async (req, res) => {
  try {
    assertCustomerCanPurchase(req.user);
    const productId = req.body.productId || req.body.product;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "ProductId is required",
      });
    }

    const cart = await addItemsToCart(req.user.id, [
      {
        productId,
        quantity: req.body.quantity ?? req.body.qty ?? 1,
        selectedVariants: req.body.selectedVariants,
        price: req.body.price,
        mrp: req.body.mrp,
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Product added successfully",
      data: cart,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }
};

export const updateQuantity = async (req, res) => {
  try {
    assertCustomerCanPurchase(req.user);
    const userId = req.user.id;
    const { cartItemId, productId, selectedVariants } = req.body;
    const quantity = Number(req.body.quantity ?? req.body.qty);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive whole number",
      });
    }

    const cart = await cartModel.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const variantKey = buildVariantKey(normalizeSelectedVariants(selectedVariants));
    const cartItem = findCartItem(cart, { cartItemId, productId, variantKey });

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart",
      });
    }

    const product = await ProductModel.findById(cartItem.product).select(
      "name stock",
    );
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (isStockEnforced() && product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `${product.name} has only ${product.stock} item(s) in stock`,
      });
    }

    cartItem.quantity = quantity;
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Quantity updated successfully",
      data: await populateCart(cart),
    });
  } catch (ex) {
    return res.status(ex.status || 500).json({
      success: false,
      message: ex.message,
    });
  }
};

export const incrementQuantity = async (req, res) => {
  req.body.quantity = Number(req.body.quantity || 0) + 1;

  if (!req.body.quantity || req.body.quantity === 1) {
    const cart = await cartModel.findOne({ user: req.user.id });
    const cartItem = cart && findCartItem(cart, req.body);
    req.body.quantity = (cartItem?.quantity || 0) + 1;
  }

  return updateQuantity(req, res);
};

export const decrementedQuantity = async (req, res) => {
  const cart = await cartModel.findOne({ user: req.user.id });
  const cartItem = cart && findCartItem(cart, req.body);

  if (!cartItem || cartItem.quantity <= 1) {
    return res.status(400).json({
      success: false,
      message: "Quantity can't be less than 1",
    });
  }

  req.body.quantity = cartItem.quantity - 1;
  return updateQuantity(req, res);
};

export const getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await cartModel.findOne({ user: userId });

    if (!cart) {
      return res.status(200).json({
        success: true,
        message: "Cart is empty",
        data: {
          user: userId,
          items: [],
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: cart.items.length === 0 ? "Cart is empty" : "Cart found successfully",
      data: await populateCart(cart),
    });
  } catch (ex) {
    return res.status(500).json({
      success: false,
      message: ex.message,
    });
  }
};

export const deletecartproduct = async (req, res) => {
  try {
    const userId = req.user.id;
    const { cartItemId, productId, selectedVariants } = req.body;

    const cart = await cartModel.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    const variantKey = buildVariantKey(normalizeSelectedVariants(selectedVariants));
    const cartItem = findCartItem(cart, { cartItemId, productId, variantKey });

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart",
      });
    }

    cart.items = cart.items.filter((item) => item._id.toString() !== cartItem._id.toString());
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
      data: await populateCart(cart),
    });
  } catch (ex) {
    return res.status(500).json({
      success: false,
      message: ex.message,
    });
  }
};

export const clearCart = async (req, res) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    cart.items = [];
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: await populateCart(cart),
    });
  } catch (ex) {
    return res.status(500).json({
      success: false,
      message: ex.message,
    });
  }
};

export const AdminGetAbandonedCarts = async (req, res) => {
  try {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
    const shouldNotify = String(req.query.notify || "").toLowerCase() === "true";
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const carts = await cartModel
      .find({
        updatedAt: { $lte: cutoff },
        "items.0": { $exists: true },
      })
      .populate("user", "email")
      .populate("items.product", CART_PRODUCT_SELECT)
      .sort({ updatedAt: 1 })
      .limit(100)
      .lean();

    if (shouldNotify) {
      await Promise.all(
        carts.map((cart) =>
          notifyAbandonedCart({
            userId: cart.user?._id || cart.user,
            email: cart.user?.email || "",
          }),
        ),
      );
    }

    return res.status(200).json({
      success: true,
      total: carts.length,
      data: carts,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
