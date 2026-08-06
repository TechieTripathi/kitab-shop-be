import express from "express";
import {
  CreateContactMessage,
  DeleteContactMessage,
  GetAdminContactMessages,
  GetMyContactMessages,
  ReplyToContactMessage,
  UpdateContactMessageStatus,
} from "./contact.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";
import { contentWriteRateLimit } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createContactMessageSchema,
  messageIdParamSchema,
  replyToContactMessageSchema,
  updateContactStatusSchema,
} from "./contact.schema.js";

const routes = express.Router();

// Public and unauthenticated, so this is the most spam-exposed write in the API.
routes.post("/", contentWriteRateLimit, validate(createContactMessageSchema), CreateContactMessage);
routes.get("/my", TokenVerify, GetMyContactMessages);
routes.get("/admin/all", isAdmin, requirePermission(ADMIN_PERMISSIONS.CONTACT_MANAGE), GetAdminContactMessages);
routes.post("/admin/:messageId/reply", isAdmin, requirePermission(ADMIN_PERMISSIONS.CONTACT_MANAGE), validate(replyToContactMessageSchema), ReplyToContactMessage);
routes.patch("/admin/:messageId/status", isAdmin, requirePermission(ADMIN_PERMISSIONS.CONTACT_MANAGE), validate(updateContactStatusSchema), UpdateContactMessageStatus);
routes.delete("/admin/:messageId", isAdmin, requirePermission(ADMIN_PERMISSIONS.CONTACT_MANAGE), validate(messageIdParamSchema), DeleteContactMessage);

export default routes;
