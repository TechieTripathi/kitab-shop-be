import express from "express";

// import { addtocart } from "./cart.controller.js";

import {
  addToCart,
  singleProduct,
  incrementQuantity,
  decrementedQuantity,
  updateQuantity,
  getCart,
  deletecartproduct,
  clearCart,
  AdminGetAbandonedCarts,
} from "./cart.controller.js";

const router = express.Router();
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  addSingleItemSchema,
  addToCartBulkSchema,
  identifyCartLineSchema,
  updateQuantitySchema,
} from "./cart.schema.js";

router.get("/", (req, res) => {
  res.send("hello world");
});

router.post("/bulk", TokenVerify, validate(addToCartBulkSchema), addToCart);

// single product

router.post("/single-add", TokenVerify, validate(addSingleItemSchema), singleProduct);
router.post("/add", TokenVerify, validate(addSingleItemSchema), singleProduct);

router.patch("/quantity", TokenVerify, validate(updateQuantitySchema), updateQuantity);
router.patch(
  "/increment-quantity",
  TokenVerify,
  validate(identifyCartLineSchema),
  incrementQuantity,
);
router.patch(
  "/decrement-quantity",
  TokenVerify,
  validate(identifyCartLineSchema),
  decrementedQuantity,
);

router.get("/get-all", TokenVerify, getCart);
router.get("/me", TokenVerify, getCart);
router.get("/admin/abandoned", isAdmin, AdminGetAbandonedCarts);

router.delete("/delete", TokenVerify, validate(identifyCartLineSchema), deletecartproduct);
router.delete("/clear", TokenVerify, clearCart);

export default router;
