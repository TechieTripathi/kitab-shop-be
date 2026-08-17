import mongoose from "mongoose";
import Category from "../categories/Category.model.js";
import HomepageSetting from "./HomepageSetting.model.js";
import ReviewModel from "../reviews/review.model.js";
import { createAuditLog } from "../audit/audit-log.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const formatFeaturedReview = (review) => {
  const data = review?.toObject ? review.toObject() : review;
  const product = data?.product && typeof data.product === "object" ? data.product : null;
  const user = data?.user && typeof data.user === "object" ? data.user : null;
  const email = user?.email || "";

  return {
    id: String(data._id),
    productId: product?._id ? String(product._id) : String(data.product || ""),
    productName: product?.name || "",
    productImage: product?.image || "",
    user: email ? email.split("@")[0] : "Verified Buyer",
    userEmail: email,
    rating: Number(data.rating) || 0,
    title: data.title || "Customer Review",
    comment: data.comment || "",
    text: data.comment || "",
    status: data.status || "published",
    date: data.createdAt || null,
  };
};

const toResponse = (setting) => ({
  bestsellerCategoryId: setting?.bestsellerCategory?._id
    ? String(setting.bestsellerCategory._id)
    : "",
  bestsellerCategoryName: setting?.bestsellerCategory?.name || "",
  categoryOrder: Array.isArray(setting?.categoryOrder)
    ? setting.categoryOrder.map((category) =>
        category?._id ? String(category._id) : String(category),
      )
    : [],
  featuredReviews: Array.isArray(setting?.featuredReviews)
    ? setting.featuredReviews
        .filter((review) => review && typeof review === "object" && review.status === "published")
        .map(formatFeaturedReview)
    : [],
  featuredReviewIds: Array.isArray(setting?.featuredReviews)
    ? setting.featuredReviews
        .map((review) => (review?._id ? String(review._id) : String(review)))
        .filter(Boolean)
    : [],
  backgroundColor: setting?.backgroundColor || "#ffffff",
  updatedAt: setting?.updatedAt || null,
});

export const GetHomepageSettings = async (req, res) => {
  try {
    const setting = await HomepageSetting.findOne({ key: "homepage" }).populate(
      "bestsellerCategory",
      "name",
    )
      .populate({
        path: "featuredReviews",
        match: { status: "published" },
        populate: [
          { path: "user", select: "email" },
          { path: "product", select: "name image" },
        ],
      })
      .lean();

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
    const categoryOrderInput = Array.isArray(req.body?.categoryOrder)
      ? req.body.categoryOrder.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const featuredReviewInput = Array.isArray(req.body?.featuredReviewIds)
      ? req.body.featuredReviewIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const backgroundColor = req.body?.backgroundColor || "#ffffff";
    let category = null;

    if (categoryId) {
      if (!isValidObjectId(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid category id" });
      }

      category = await Category.findById(categoryId).select("name");
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }
    }

    const categoryOrder = [...new Set(categoryOrderInput)];
    if (categoryOrder.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "Invalid category order id" });
    }

    if (categoryOrder.length > 0) {
      const categoryCount = await Category.countDocuments({ _id: { $in: categoryOrder } });
      if (categoryCount !== categoryOrder.length) {
        return res.status(404).json({ success: false, message: "One or more ordered categories were not found" });
      }
    }

    const featuredReviewIds = [...new Set(featuredReviewInput)];
    if (featuredReviewIds.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "Invalid featured review id" });
    }

    if (featuredReviewIds.length > 0) {
      const reviewCount = await ReviewModel.countDocuments({
        _id: { $in: featuredReviewIds },
        status: "published",
      });
      if (reviewCount !== featuredReviewIds.length) {
        return res.status(404).json({ success: false, message: "Only published reviews can be featured" });
      }
    }

    const setting = await HomepageSetting.findOneAndUpdate(
      { key: "homepage" },
      {
        $set: {
          bestsellerCategory: category?._id || null,
          categoryOrder,
          featuredReviews: featuredReviewIds,
          backgroundColor: backgroundColor,
          updatedBy: req.user.id,
        },
        $setOnInsert: { key: "homepage" },
      },
      { returnDocument: "after", upsert: true, runValidators: true },
    )
      .populate("bestsellerCategory", "name")
      .populate({
        path: "featuredReviews",
        match: { status: "published" },
        populate: [
          { path: "user", select: "email" },
          { path: "product", select: "name image" },
        ],
      });

    await createAuditLog({
      admin: req.user.id,
      action: "UPDATE",
      module: "Homepage",
      targetId: setting._id,
      targetName: "Homepage settings",
      description: `Updated homepage curation: bestseller ${category ? category.name : "all categories"}, ${categoryOrder.length} ordered categories, ${featuredReviewIds.length} featured reviews`,
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

export const GetHomepageReviewOptions = async (req, res) => {
  try {
    const reviews = await ReviewModel.find({ status: "published" })
      .populate("user", "email")
      .populate("product", "name image")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      reviews: reviews.map(formatFeaturedReview),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
