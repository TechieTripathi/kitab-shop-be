import express from "express";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import {
  ApplyCoupon,
  GetAvailableCoupons,
} from "./coupon.controller.js";
import { couponRateLimit } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { applyCouponSchema } from "./coupon.schema.js";

const router = express.Router();

router.get("/active", TokenVerify, GetAvailableCoupons);
// Limited so an attacker cannot enumerate valid codes by spraying guesses.
router.post("/apply", couponRateLimit, TokenVerify, validate(applyCouponSchema), ApplyCoupon);

export default router;
