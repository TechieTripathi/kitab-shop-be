import { looseBody, z } from "../../middleware/validate.middleware.js";

export const subscribeNewsletterSchema = {
  body: looseBody({
    email: z
      .string({ error: "Email is required" })
      .trim()
      .min(1, "Email is required")
      .max(254, "Email is too long")
      .email("Enter a valid email address"),
  }),
};
