import mongoose from "mongoose";
import Category from "../categories/Category.model.js";
import HomepageSetting from "./HomepageSetting.model.js";
import { createAuditLog } from "../audit/audit-log.js";

const toResponse = (setting) => ({
  bestsellerCategoryId: setting?.bestsellerCategory?._id
    ? String(setting.bestsellerCategory._id)
    : "",
  bestsellerCategoryName: setting?.bestsellerCategory?.name || "",
  backgroundColor: setting?.backgroundColor || "#ffffff",
  updatedAt: setting?.updatedAt || null,
});

export const GetHomepageSettings = async (req, res) => {
  try {
    const setting = await HomepageSetting.findOne({ key: "homepage" }).populate(
      "bestsellerCategory",
      "name",
    ).lean();

    return res.status(200).json({
      success: true,
      data: toResponse(setting),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const UpdateHomepageSettings = async (req, res) => {
  try {
    const categoryId = String(req.body?.bestsellerCategoryId || "").trim();
    const backgroundColor = req.body?.backgroundColor || "#ffffff";
    let category = null;

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid category id" });
      }

      category = await Category.findById(categoryId).select("name");
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }
    }

    const setting = await HomepageSetting.findOneAndUpdate(
      { key: "homepage" },
      {
        $set: {
          bestsellerCategory: category?._id || null,
          backgroundColor: backgroundColor,
          updatedBy: req.user.id,
        },
        $setOnInsert: { key: "homepage" },
      },
      { new: true, upsert: true, runValidators: true },
    ).populate("bestsellerCategory", "name");

    await createAuditLog({
      admin: req.user.id,
      action: "UPDATE",
      module: "Homepage",
      targetId: setting._id,
      targetName: "Bestseller category",
      description: category
        ? `Set homepage bestseller category to ${category.name}`
        : "Set homepage bestseller category to all categories",
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Homepage category updated successfully",
      data: toResponse(setting),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
