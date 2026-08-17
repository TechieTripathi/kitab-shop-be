import mongoose from "mongoose";
import Policy from "./Policy.model.js";
import { createAuditLog } from "../audit/audit-log.js";

const normalizeSlug = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizePosition = (value) => {
  if (value === undefined || value === null || value === "") return 0;
  const position = Number(value);
  return Number.isNaN(position) ? 0 : position;
};

const defaultPolicies = [
  {
    title: "Terms of Use",
    slug: "terms",
    heading: "Terms of Use",
    content:
      "The basic terms that govern your use of Kitab Shop.\n\nUsing our platform\n\nBy using Kitab Shop, you agree to provide accurate information at checkout and to use our books and digital editions for personal, lawful purposes only.\n\nProduct descriptions\n\nWe do our best to keep cover images, page counts and edition details accurate, but publishers occasionally revise covers and reprints - the ISBN on the product page is always the authoritative identifier.",
    position: 1,
  },
  {
    title: "Privacy Policy",
    slug: "privacy",
    heading: "Privacy Policy",
    content:
      "How we handle the information you share with us.\n\nWhat we collect\n\nYour name, contact details and delivery address are used only to fulfil your order, and your reading preferences only to improve recommendations - never sold to third parties.",
    position: 2,
  },
  {
    title: "Refund Policy",
    slug: "refund",
    heading: "Refund Policy",
    content:
      "How refunds work once a return or cancellation is approved.\n\nRefund timelines\n\nApproved refunds are credited to your original payment method within 5-7 business days.\n\nCash on Delivery orders\n\nFor COD orders, refunds are processed via UPI or bank transfer. You will be asked for these details once your return is approved.",
    position: 3,
  },
];

const normalizeStyles = (styles = {}) => {
  const validFontFamilies = ["default", "serif", "sans", "mono"];
  const validWeights = ["normal", "medium", "semibold", "bold"];
  const validStyles = ["normal", "italic"];
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    if (Number.isNaN(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  };
  const normalizeFontBlock = (block = {}, fallback = {}) => ({
    fontFamily: validFontFamilies.includes(block.fontFamily) ? block.fontFamily : fallback.fontFamily,
    fontSize: clamp(block.fontSize, 1, fallback.maxSize, fallback.fontSize),
    fontWeight: validWeights.includes(block.fontWeight) ? block.fontWeight : fallback.fontWeight,
    fontStyle: validStyles.includes(block.fontStyle) ? block.fontStyle : fallback.fontStyle,
    textColor: /^#[0-9a-f]{6}$/i.test(String(block.textColor || ""))
      ? block.textColor
      : fallback.textColor,
  });

  // Backward compatibility for older flat style payloads.
  if (styles.fontFamily || styles.headingSize || styles.bodySize) {
    return {
      title: normalizeFontBlock(
        {
          fontFamily: styles.fontFamily,
          fontSize: 12,
          fontWeight: styles.fontWeight,
          fontStyle: styles.fontStyle,
          textColor: "#374151",
        },
        { fontFamily: "default", fontSize: 12, maxSize: 64, fontWeight: "normal", fontStyle: "normal", textColor: "#374151" },
      ),
      heading: normalizeFontBlock(
        {
          fontFamily: styles.fontFamily,
          fontSize: styles.headingSize,
          fontWeight: "bold",
          fontStyle: styles.fontStyle,
          textColor: "#111827",
        },
        { fontFamily: "default", fontSize: 24, maxSize: 96, fontWeight: "bold", fontStyle: "normal", textColor: "#111827" },
      ),
      body: normalizeFontBlock(
        {
          fontFamily: styles.fontFamily,
          fontSize: styles.bodySize,
          fontWeight: styles.fontWeight,
          fontStyle: styles.fontStyle,
          textColor: styles.textColor,
        },
        { fontFamily: "default", fontSize: 14, maxSize: 64, fontWeight: "normal", fontStyle: "normal", textColor: "#4B5563" },
      ),
    };
  }

  return {
    title: normalizeFontBlock(styles.title, {
      fontFamily: "default",
      fontSize: 12,
      maxSize: 64,
      fontWeight: "normal",
      fontStyle: "normal",
      textColor: "#374151",
    }),
    heading: normalizeFontBlock(styles.heading, {
      fontFamily: "default",
      fontSize: 24,
      maxSize: 96,
      fontWeight: "bold",
      fontStyle: "normal",
      textColor: "#111827",
    }),
    body: normalizeFontBlock(styles.body, {
      fontFamily: "default",
      fontSize: 14,
      maxSize: 64,
      fontWeight: "normal",
      fontStyle: "normal",
      textColor: "#4B5563",
    }),
  };
};

const sendServerError = (res, error) =>
  res.status(500).json({
    success: false,
    message: error.message,
  });

const ensureDefaultPolicies = async () => {
  for (const policy of defaultPolicies) {
    await Policy.findOneAndUpdate(
      { slug: policy.slug },
      { $setOnInsert: { ...policy, styles: normalizeStyles({}) } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
};

// POST /api/v1/policy/create
export const CreatePolicy = async (req, res) => {
  try {
    const { title, slug, heading, content, position, styles } = req.body;
    const normalizedSlug = normalizeSlug(slug);

    if (!title || !normalizedSlug || !heading || !content) {
      return res.status(400).json({
        success: false,
        message: "Title, slug, heading, and content are required",
      });
    }

    const existingPolicy = await Policy.findOne({ slug: normalizedSlug });
    if (existingPolicy) {
      return res.status(400).json({
        success: false,
        message: "A policy with this slug already exists",
      });
    }

    const policy = await Policy.create({
      title,
      slug: normalizedSlug,
      heading,
      content,
      styles: normalizeStyles(styles),
      position: normalizePosition(position),
      adminId: req.user?.id,
    });

    await createAuditLog({
      admin: req.user?.id,
      action: "CREATE_POLICY",
      module: "Policy",
      targetId: policy._id,
      targetName: policy.title,
      description: `Created policy ${policy.title}`,
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Policy created successfully",
      data: policy,
    });
  } catch (error) {
    console.error("CreatePolicy Error:", error);
    return sendServerError(res, error);
  }
};

// GET /api/v1/policy/all-policies
export const GetAllPolicies = async (req, res) => {
  try {
    await ensureDefaultPolicies();
    const policies = await Policy.find().sort({ position: 1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Policies fetched successfully",
      data: policies,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// GET /api/v1/policy/:slug
export const GetPolicyBySlug = async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    await ensureDefaultPolicies();
    const policy = await Policy.findOne({ slug });

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: "Policy not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Policy fetched successfully",
      data: policy,
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};

// PUT /api/v1/policy/update/:id
export const UpdatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, heading, content, position, styles } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid policy id",
      });
    }

    const policy = await Policy.findById(id);
    if (!policy) {
      return res.status(404).json({
        success: false,
        message: "Policy not found",
      });
    }

    if (slug !== undefined) {
      const normalizedSlug = normalizeSlug(slug);
      if (!normalizedSlug) {
        return res.status(400).json({
          success: false,
          message: "Slug is required",
        });
      }

      const existingPolicy = await Policy.findOne({
        slug: normalizedSlug,
        _id: { $ne: id },
      });

      if (existingPolicy) {
        return res.status(400).json({
          success: false,
          message: "Another policy with this slug already exists",
        });
      }

      policy.slug = normalizedSlug;
    }

    if (title !== undefined) policy.title = title;
    if (heading !== undefined) policy.heading = heading;
    if (content !== undefined) policy.content = content;
    if (styles !== undefined) policy.styles = normalizeStyles(styles);
    if (position !== undefined) policy.position = normalizePosition(position);
    policy.lastEditedByAdminId = req.user?.id;

    await policy.save();

    await createAuditLog({
      admin: req.user?.id,
      action: "UPDATE_POLICY",
      module: "Policy",
      targetId: policy._id,
      targetName: policy.title,
      description: `Updated policy ${policy.title}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Policy updated successfully",
      data: policy,
    });
  } catch (error) {
    console.error("UpdatePolicy Error:", error);
    return sendServerError(res, error);
  }
};

// DELETE /api/v1/policy/delete/:id
export const DeletePolicy = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid policy id",
      });
    }

    const policy = await Policy.findByIdAndDelete(id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: "Policy not found",
      });
    }

    await createAuditLog({
      admin: req.user?.id,
      action: "DELETE_POLICY",
      module: "Policy",
      targetId: policy._id,
      targetName: policy.title,
      description: `Deleted policy ${policy.title}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Policy deleted successfully",
    });
  } catch (error) {
    return sendServerError(res, error);
  }
};
