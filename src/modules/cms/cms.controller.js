import CmsBlock from "./CmsBlock.model.js";
import { createAuditLog } from "../audit/audit-log.js";

const normalizePageKey = (pageType, pageKey) =>
  pageType === "homepage" ? "homepage" : String(pageKey || "").trim();

const buildPayload = (body = {}, adminId = null) => {
  const pageType = body.pageType || "homepage";
  const pageKey = normalizePageKey(pageType, body.pageKey || body.categoryId);
  if (!["homepage", "category"].includes(pageType)) {
    const error = new Error("pageType must be homepage or category");
    error.statusCode = 400;
    throw error;
  }
  if (!pageKey) {
    const error = new Error("pageKey is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    pageType,
    pageKey,
    title: String(body.title || "").trim(),
    type: body.type || "custom",
    content: body.content || {},
    position: Number(body.position || 0),
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
    updatedBy: adminId,
  };
};

export const GetCmsBlocks = async (req, res) => {
  try {
    const pageType = req.query.pageType || "homepage";
    const pageKey = normalizePageKey(pageType, req.query.pageKey || req.query.categoryId);
    const filter = { pageType, pageKey };

    if (req.query.enabled !== "all") filter.enabled = true;

    const blocks = await CmsBlock.find(filter).sort({ position: 1, createdAt: 1 }).lean();
    return res.status(200).json({ success: true, data: blocks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminGetCmsBlocks = async (req, res) => {
  try {
    const filter = {};
    if (req.query.pageType) filter.pageType = req.query.pageType;
    if (req.query.pageKey || req.query.categoryId) {
      filter.pageKey = normalizePageKey(req.query.pageType || "homepage", req.query.pageKey || req.query.categoryId);
    }

    const blocks = await CmsBlock.find(filter).sort({ pageType: 1, pageKey: 1, position: 1 }).lean();
    return res.status(200).json({ success: true, data: blocks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminCreateCmsBlock = async (req, res) => {
  try {
    const payload = buildPayload(req.body, req.user.id);
    if (!payload.title) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const block = await CmsBlock.create(payload);
    await createAuditLog({
      admin: req.user.id,
      action: "CREATE_CMS_BLOCK",
      module: "CMS",
      targetId: block._id,
      targetName: block.title,
      description: `Created CMS block ${block.title}`,
      req,
    });

    return res.status(201).json({ success: true, message: "CMS block created", data: block });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const AdminUpdateCmsBlock = async (req, res) => {
  try {
    const payload = buildPayload(req.body, req.user.id);
    const block = await CmsBlock.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: true },
    );
    if (!block) return res.status(404).json({ success: false, message: "CMS block not found" });

    await createAuditLog({
      admin: req.user.id,
      action: "UPDATE_CMS_BLOCK",
      module: "CMS",
      targetId: block._id,
      targetName: block.title,
      description: `Updated CMS block ${block.title}`,
      req,
    });

    return res.status(200).json({ success: true, message: "CMS block updated", data: block });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const AdminDeleteCmsBlock = async (req, res) => {
  try {
    const block = await CmsBlock.findByIdAndDelete(req.params.id);
    if (!block) return res.status(404).json({ success: false, message: "CMS block not found" });

    await createAuditLog({
      admin: req.user.id,
      action: "DELETE_CMS_BLOCK",
      module: "CMS",
      targetId: block._id,
      targetName: block.title,
      description: `Deleted CMS block ${block.title}`,
      req,
    });

    return res.status(200).json({ success: true, message: "CMS block deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

