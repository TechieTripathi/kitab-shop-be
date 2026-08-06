import { boundedString, looseBody, objectId, z } from "../../middleware/validate.middleware.js";

// The controller normalises subject against its own allow-list and falls back to
// "Other", so the schema only bounds length here.
export const createContactMessageSchema = {
  body: looseBody({
    name: boundedString({ label: "Name", min: 2, max: 120 }),
    email: z
      .string({ error: "Email is required" })
      .trim()
      .min(1, "Email is required")
      .max(254, "Email is too long")
      .email("Enter a valid email address"),
    phone: z.string().trim().max(20, "Phone number is too long").optional(),
    subject: z.string().trim().max(120).optional(),
    message: boundedString({ label: "Message", min: 5, max: 5000 }),
    userId: objectId("User id").optional(),
    userEmail: z.string().trim().max(254).optional(),
  }),
};

export const replyToContactMessageSchema = {
  params: looseBody({ messageId: objectId("Message id") }),
  body: looseBody({
    message: boundedString({ label: "Reply message", min: 1, max: 5000 }),
  }),
};

export const updateContactStatusSchema = {
  params: looseBody({ messageId: objectId("Message id") }),
  body: looseBody({
    status: z.enum(["read", "unread"], { error: "Status must be read or unread" }),
  }),
};

export const messageIdParamSchema = {
  params: looseBody({ messageId: objectId("Message id") }),
};
