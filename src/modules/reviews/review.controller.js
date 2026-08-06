import mongoose from "mongoose";
import OrderModel from "../orders/Order.model.js";
import ProductModel from "../products/Product.model.js";
import ReviewModel from "./review.model.js";
import { createAuditLog } from "../audit/audit-log.js";
import { deleteImageAsset, saveImageAsset } from "../../utils/image-upload.js";

const PURCHASED_ORDER_STATUSES = [
  "Confirmed",
  "Packed",
  "Shipped",
  "Out For Delivery",
  "Delivered",
];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const formatReviewerName = (user) => {
  const email = user?.email || "";
  return email ? email.split("@")[0] : "Verified Buyer";
};

const formatReview = (review) => {
  const data = review.toObject ? review.toObject() : review;
  const product =
    data.product && typeof data.product === "object" ? data.product : null;
  const user = data.user && typeof data.user === "object" ? data.user : null;

  return {
    id: data._id,
    productId: product?._id || data.product,
    productName: product?.name || "",
    productImage: product?.image || "",
    productBrand: product?.brand || "",
    productCategory: product?.category_id?.name || "",
    userId: user?._id || data.user,
    user: formatReviewerName(data.user),
    userEmail: user?.email || "",
    orderId: data.order?._id || data.order || "",
    rating: data.rating,
    title: data.title || "Customer Review",
    comment: data.comment,
    text: data.comment,
    images: Array.isArray(data.images)
      ? data.images
          .filter((image) => image?.url)
          .map((image) => ({
            url: image.url,
            public_id: image.public_id || "",
          }))
      : [],
    status: data.status,
    date: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const buildReviewImageUpdate = async ({ file, name }) => {
  if (!file) return null;

  const imageAsset = await saveImageAsset({
    file,
    folder: "reviews",
    name,
    width: 900,
    height: 900,
    fit: "inside",
    quality: 82,
  });

  return imageAsset
    ? [{ url: imageAsset.image, public_id: imageAsset.public_id }]
    : null;
};

const getReviewSummary = async (productId) => {
  const productObjectId =
    productId instanceof mongoose.Types.ObjectId
      ? productId
      : new mongoose.Types.ObjectId(productId);

  const [summary] = await ReviewModel.aggregate([
    {
      $match: {
        product: productObjectId,
        status: "published",
      },
    },
    {
      $group: {
        _id: "$product",
        rating: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  return {
    rating: summary ? Number(summary.rating.toFixed(1)) : 0,
    ratingCount: summary?.ratingCount || 0,
  };
};

const findPurchasedOrder = async (userId, productId) =>
  OrderModel.findOne({
    user: userId,
    "items.product": productId,
    orderStatus: { $in: PURCHASED_ORDER_STATUSES },
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

export const GetProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const reviews = await ReviewModel.find({
      product: productId,
      status: "published",
    })
      .populate("user", "email")
      .populate("product", "name image")
      .sort({ createdAt: -1 })
      .lean();

    const summary = await getReviewSummary(productId);

    return res.status(200).json({
      success: true,
      ...summary,
      reviews: reviews.map(formatReview),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetReviewEligibility = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const [order, existingReview] = await Promise.all([
      findPurchasedOrder(userId, productId),
      ReviewModel.findOne({ user: userId, product: productId, status: "published" })
        .populate("user", "email")
        .populate("product", "name image")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      canReview: Boolean(order),
      hasReviewed: Boolean(existingReview),
      review: existingReview ? formatReview(existingReview) : null,
      message: order
        ? "You can review this product"
        : "You can review this product after buying it",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const CreateOrUpdateReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.id;
    const rating = Number(req.body.rating);
    const title = String(req.body.title || "Customer Review").trim();
    const comment = String(req.body.comment || req.body.text || "").trim();

    if (!isValidObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    if (comment.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Review comment must be at least 3 characters",
      });
    }

    if (title.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Review title cannot exceed 120 characters",
      });
    }

    const [product, order] = await Promise.all([
      ProductModel.findById(productId).select("_id").lean(),
      findPurchasedOrder(userId, productId),
    ]);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!order) {
      return res.status(403).json({
        success: false,
        message: "You can review this product only after buying it",
      });
    }

    const uploadedImages = await buildReviewImageUpdate({
      file: req.file,
      name: `${productId}-review`,
    });
    const shouldRemoveImage = String(req.body.removeImage || "").toLowerCase() === "true";

    const setPayload = {
      order: order._id,
      rating,
      title: title || "Customer Review",
      comment,
      status: "published",
    };

    if (uploadedImages || shouldRemoveImage) {
      const oldReview = await ReviewModel.findOne({ user: userId, product: productId })
        .select("images")
        .lean();

      await Promise.all(
        (oldReview?.images || []).map((image) => deleteImageAsset(image.public_id)),
      );

      setPayload.images = uploadedImages || [];
    }

    const review = await ReviewModel.findOneAndUpdate(
      { user: userId, product: productId },
      {
        $set: setPayload,
        $setOnInsert: {
          user: userId,
          product: productId,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    )
      .populate("user", "email")
      .populate("product", "name image")
      .lean();

    const summary = await getReviewSummary(productId);

    return res.status(200).json({
      success: true,
      message: "Review saved successfully",
      ...summary,
      review: formatReview(review),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetMyReviews = async (req, res) => {
  try {
    const reviews = await ReviewModel.find({ user: req.user.id })
      .populate("user", "email")
      .populate("product", "name image")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      reviews: reviews.map(formatReview),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const UpdateReview = async (req, res) => {
  try {
    const rating = Number(req.body.rating);
    const title = String(req.body.title || "Customer Review").trim();
    const comment = String(req.body.comment || req.body.text || "").trim();

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    if (comment.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Review comment must be at least 3 characters",
      });
    }


    if (title.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Review title cannot exceed 120 characters",
      });
    }

    const uploadedImages = await buildReviewImageUpdate({
      file: req.file,
      name: `${req.params.reviewId}-review`,
    });
    const shouldRemoveImage = String(req.body.removeImage || "").toLowerCase() === "true";

    const setPayload = {
      rating,
      title: title || "Customer Review",
      comment,
      status: "published",
    };

    if (uploadedImages || shouldRemoveImage) {
      const oldReview = await ReviewModel.findOne({
        _id: req.params.reviewId,
        user: req.user.id,
      })
        .select("images")
        .lean();

      await Promise.all(
        (oldReview?.images || []).map((image) => deleteImageAsset(image.public_id)),
      );

      setPayload.images = uploadedImages || [];
    }

    const review = await ReviewModel.findOneAndUpdate(
      { _id: req.params.reviewId, user: req.user.id },
      { $set: setPayload },
      { returnDocument: "after", runValidators: true },
    )
      .populate("user", "email")
      .populate("product", "name image")
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    const summary = await getReviewSummary(review.product._id || review.product);

    return res.status(200).json({
      success: true,
      message: "Review updated successfully",
      ...summary,
      review: formatReview(review),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const DeleteReview = async (req, res) => {
  try {
    const review = await ReviewModel.findOneAndDelete({
      _id: req.params.reviewId,
      user: req.user.id,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    await Promise.all(
      (review.images || []).map((image) => deleteImageAsset(image.public_id)),
    );

    const summary = await getReviewSummary(review.product);

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      ...summary,
      productId: review.product,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetAdminReviews = async (req, res) => {
  try {
    const { productId, status, search } = req.query;
    const filter = {};

    if (productId && productId !== "all") {
      if (!isValidObjectId(productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product id",
        });
      }

      filter.product = productId;
    }

    if (status && status !== "all") {
      filter.status = status === "hidden" ? "hidden" : "published";
    }

    let reviews = await ReviewModel.find(filter)
      .populate("user", "email roles")
      .populate({
        path: "product",
        select: "name image brand category_id",
        populate: { path: "category_id", select: "name" },
      })
      .populate("order", "_id orderStatus createdAt")
      .sort({ createdAt: -1 })
      .lean();

    if (search) {
      const query = String(search).toLowerCase();
      reviews = reviews.filter((review) => {
        const formatted = formatReview(review);
        return (
          formatted.productName.toLowerCase().includes(query) ||
          formatted.productBrand.toLowerCase().includes(query) ||
          formatted.userEmail.toLowerCase().includes(query) ||
          formatted.title.toLowerCase().includes(query) ||
          formatted.comment.toLowerCase().includes(query)
        );
      });
    }

    return res.status(200).json({
      success: true,
      total: reviews.length,
      reviews: reviews.map(formatReview),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const UpdateAdminReviewStatus = async (req, res) => {
  try {
    const nextStatus =
      req.body.status === "hidden" || req.body.status === "rejected"
        ? "hidden"
        : "published";

    const review = await ReviewModel.findByIdAndUpdate(
      req.params.reviewId,
      { $set: { status: nextStatus } },
      { returnDocument: "after", runValidators: true },
    )
      .populate("user", "email roles")
      .populate({
        path: "product",
        select: "name image brand category_id",
        populate: { path: "category_id", select: "name" },
      })
      .populate("order", "_id orderStatus createdAt")
      .lean();

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Review status updated successfully",
      review: formatReview(review),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const DeleteAdminReview = async (req, res) => {
  try {
    const review = await ReviewModel.findByIdAndDelete(req.params.reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    await Promise.all(
      (review.images || []).map((image) => deleteImageAsset(image.public_id)),
    );

    await createAuditLog({
      admin: req.user.id,
      action: "DELETE",
      module: "Reviews",
      targetId: review._id,
      targetName: review.title || "Customer Review",
      description: "Deleted a customer product review",
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      data: { id: review._id, productId: review.product },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
