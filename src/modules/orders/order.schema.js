import {
  boundedString,
  looseBody,
  objectId,
  z,
} from "../../middleware/validate.middleware.js";

const MAX_ORDER_ITEMS = 100;

// Mirrors the controller's own check so a bad key is rejected before any
// database lookup happens.
const idempotencyKey = z
  .string({ error: "A valid checkout idempotency key is required" })
  .regex(/^[A-Za-z0-9_-]{16,100}$/, "A valid checkout idempotency key is required");

const orderItem = looseBody({
  productId: objectId("Product id").optional(),
  product: objectId("Product id").optional(),
  quantity: z.coerce
    .number({ error: "Quantity must be a number" })
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(100, "Quantity cannot exceed 100")
    .optional(),
}).refine((item) => Boolean(item.productId || item.product), {
  message: "Product id is required for every item",
  path: ["productId"],
});

const shippingAddress = looseBody({
  name: boundedString({ label: "Name", max: 120 }).optional(),
  phone: boundedString({ label: "Phone", max: 20 }).optional(),
  addressLine1: boundedString({ label: "Address", max: 250 }).optional(),
  addressLine2: z.string().trim().max(250).optional(),
  city: boundedString({ label: "City", max: 100 }).optional(),
  state: boundedString({ label: "State", max: 100 }).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "Enter a valid pincode")
    .optional(),
  country: z.string().trim().max(100).optional(),
});

export const placeOrderSchema = {
  body: looseBody({
    idempotencyKey,
    items: z
      .array(orderItem)
      .max(MAX_ORDER_ITEMS, `An order cannot contain more than ${MAX_ORDER_ITEMS} items`)
      .optional(),
    // Left permissive: the controller only accepts "cod" here and returns a
    // clearer domain message than a schema rejection would.
    paymentMethod: z.string().trim().max(40).optional(),
    shippingAddress: shippingAddress.optional(),
    coupon: z.unknown().optional(),
    useWallet: z.coerce.boolean().optional(),
  }),
};

export const orderIdParamSchema = {
  params: looseBody({
    orderId: objectId("Order id"),
  }),
};

export const updateOrderStatusSchema = {
  params: looseBody({ orderId: objectId("Order id") }),
  body: looseBody({
    orderStatus: boundedString({ label: "Order status", max: 60 }),
  }),
};

export const addOrderNoteSchema = {
  params: looseBody({ orderId: objectId("Order id") }),
  body: looseBody({
    note: boundedString({ label: "Note", max: 2000 }),
  }),
};

export const partialCancelSchema = {
  params: looseBody({ orderId: objectId("Order id") }),
  body: looseBody({
    productId: objectId("Product id"),
    quantity: z.coerce
      .number({ error: "Quantity must be a number" })
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(100, "Quantity cannot exceed 100"),
    reason: z.string().trim().max(500).optional(),
  }),
};

export const splitShipmentSchema = {
  params: looseBody({ orderId: objectId("Order id") }),
  body: looseBody({
    items: z.array(z.unknown()).min(1, "At least one item is required"),
  }),
};
