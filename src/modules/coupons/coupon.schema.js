import { boundedString, looseBody, z } from "../../middleware/validate.middleware.js";

export const applyCouponSchema = {
  body: looseBody({
    // Not a Mongo id despite the name: coupon.service.js normalises this to an
    // uppercased human-readable code and matches on the `couponId` field.
    couponId: boundedString({ label: "Coupon code", max: 60 }),
    // Cart lines are re-read and repriced server-side, so shape is checked but
    // contents are not trusted for pricing.
    items: z
      .array(z.unknown(), { error: "Cart items are required" })
      .min(1, "Cart items are required")
      .max(100, "Too many items"),
  }),
};
