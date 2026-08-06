import express from "express";

import { TokenVerify } from "../../middleware/auth.middleware.js";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from "./wishlist.controller.js";

const router = express.Router();

router.get("/get-wishlist", TokenVerify, getWishlist);
router.get("/me", TokenVerify, getWishlist);
router.post("/add-wishlist/:productId", TokenVerify, addToWishlist);
router.post("/add/:productId", TokenVerify, addToWishlist);

router.delete("/remove-wishlist/:productId", TokenVerify, removeFromWishlist);
router.delete("/remove/:productId", TokenVerify, removeFromWishlist);
export default router;
