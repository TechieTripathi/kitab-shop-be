import { looseBody, objectId, z } from "../../middleware/validate.middleware.js";

// Review writes arrive as multipart/form-data (an optional image field), so
// every value is a string on the wire and needs coercion.
const rating = z.coerce
  .number({ error: "Rating must be a number" })
  .int("Rating must be a whole number")
  .min(1, "Rating must be between 1 and 5")
  .max(5, "Rating must be between 1 and 5");

const reviewText = looseBody({
  rating,
  title: z.string().trim().max(150, "Title must be 150 characters or fewer").optional(),
  comment: z.string().trim().max(5000, "Comment must be 5000 characters or fewer").optional(),
  text: z.string().trim().max(5000, "Comment must be 5000 characters or fewer").optional(),
  removeImage: z.union([z.string(), z.boolean()]).optional(),
});

export const createReviewSchema = {
  params: looseBody({ productId: objectId("Product id") }),
  body: reviewText,
};

export const updateReviewSchema = {
  params: looseBody({ reviewId: objectId("Review id") }),
  body: reviewText,
};

export const reviewIdParamSchema = {
  params: looseBody({ reviewId: objectId("Review id") }),
};

export const productIdParamSchema = {
  params: looseBody({ productId: objectId("Product id") }),
};

export const adminReviewStatusSchema = {
  params: looseBody({ reviewId: objectId("Review id") }),
  body: looseBody({
    status: z.string().trim().max(40).optional(),
  }),
};
