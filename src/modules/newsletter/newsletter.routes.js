import express from "express";
import { GetNewsletterSubscribers, SubscribeToNewsletter } from "./newsletter.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { contentWriteRateLimit } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { subscribeNewsletterSchema } from "./newsletter.schema.js";

const routes = express.Router();

// Public and unauthenticated, so rate-limited the same way the contact form is.
routes.post("/subscribe", contentWriteRateLimit, validate(subscribeNewsletterSchema), SubscribeToNewsletter);
routes.get("/admin/subscribers", isAdmin, GetNewsletterSubscribers);

export default routes;
