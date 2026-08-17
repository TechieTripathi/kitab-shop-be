import { looseBody, objectId, z } from "../../middleware/validate.middleware.js";

// A sanity ceiling against fat-finger/bot quantities — not a stock check.
// The real, per-product limit is each item's actual stock, enforced in
// cart.controller.js (addItemsToCart / updateQuantity) against live
// Product.stock, since that's the only place that can know it.
const MAX_QUANTITY_PER_LINE = 999;
const MAX_BULK_ITEMS = 100;

const quantity = z.coerce
  .number({ error: "Quantity must be a number" })
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(MAX_QUANTITY_PER_LINE, `Quantity cannot exceed ${MAX_QUANTITY_PER_LINE}`);

// Variant selections are free-form key/value pairs (size, colour). Values are
// length-capped so a caller cannot store arbitrarily large blobs on the cart.
const selectedVariants = z
  .record(z.string().max(60), z.union([z.string().max(120), z.number(), z.boolean(), z.null()]))
  .optional();

// Money fields are accepted from the client by the existing controller, so they
// are validated rather than removed. Server-side repricing still happens at
// checkout in order-pricing.service.js.
const money = z.coerce
  .number({ error: "Price must be a number" })
  .nonnegative("Price cannot be negative")
  .max(10_000_000, "Price is out of range")
  .optional();

const cartLine = looseBody({
  productId: objectId("Product id").optional(),
  product: objectId("Product id").optional(),
  quantity: quantity.optional(),
  qty: quantity.optional(),
  selectedVariants,
  price: money,
  mrp: money,
}).refine((line) => Boolean(line.productId || line.product), {
  message: "Product id is required",
  path: ["productId"],
});

export const addToCartBulkSchema = {
  body: looseBody({
    items: z
      .array(cartLine, { error: "Items must be a list" })
      .min(1, "At least one item is required")
      .max(MAX_BULK_ITEMS, `Cannot add more than ${MAX_BULK_ITEMS} items at once`),
  }),
};

export const addSingleItemSchema = {
  body: cartLine,
};

export const updateQuantitySchema = {
  body: looseBody({
    cartItemId: objectId("Cart item id").optional(),
    productId: objectId("Product id").optional(),
    selectedVariants,
    quantity: quantity.optional(),
    qty: quantity.optional(),
  }).refine((body) => Boolean(body.cartItemId || body.productId), {
    message: "Cart item id or product id is required",
    path: ["cartItemId"],
  }),
};

// Increment/decrement derive the new quantity server-side, so they only need to
// identify the line.
export const identifyCartLineSchema = {
  body: looseBody({
    cartItemId: objectId("Cart item id").optional(),
    productId: objectId("Product id").optional(),
    selectedVariants,
  }).refine((body) => Boolean(body.cartItemId || body.productId), {
    message: "Cart item id or product id is required",
    path: ["cartItemId"],
  }),
};
