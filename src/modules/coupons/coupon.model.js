import mongoose from "mongoose";

const generateCouponId = () =>
  `CPN${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

const couponUsageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
    },
    count: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const couponSchema = new mongoose.Schema(
  {
    couponId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
      default: generateCouponId,
    },
    targetType: {
      type: String,
      enum: ["all", "category", "product"],
      default: "all",
      index: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      index: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      index: true,
    },
    assignedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      index: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
      default: "percentage",
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    expireDate: {
      type: Date,
      required: true,
    },
    maxLimit: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    minPurchaseAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    maxPurchaseAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    usage: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usedBy: {
      type: [couponUsageSchema],
      default: [],
    },
  },
  { timestamps: true },
);

couponSchema.pre("validate", function () {
  if (!this.couponId) this.couponId = generateCouponId();
  this.couponId = String(this.couponId).trim().toUpperCase();
  this.customerEmail = this.customerEmail ? String(this.customerEmail).trim().toLowerCase() : undefined;

  if ((!this.targetType || this.targetType === "all") && this.product_id && !this.isModified("targetType")) {
    this.targetType = "product";
  }
  if (this.targetType === "all") {
    this.product_id = undefined;
    this.category_id = undefined;
  }
  if (this.targetType === "category" && !this.category_id) {
    this.invalidate("category_id", "Category is required for category coupon");
  }
  if (this.targetType === "product" && !this.product_id) {
    this.invalidate("product_id", "Product is required for product coupon");
  }
  if (this.discountType === "percentage" && this.discountValue > 100) {
    this.invalidate("discountValue", "Percentage discount cannot be greater than 100");
  }
  if (this.minPurchaseAmount === undefined || this.minPurchaseAmount < 0) {
    this.minPurchaseAmount = 0;
  }
  if (this.startDate && this.expireDate && this.expireDate < this.startDate) {
    this.invalidate("expireDate", "Expire date must be after start date");
  }
  this.usage = Array.isArray(this.usedBy) ? this.usedBy.length : this.usage || 0;
});

couponSchema.index({ isActive: 1, startDate: 1, expireDate: 1 });
couponSchema.index({ isActive: 1, assignedUser: 1, expireDate: 1 });
couponSchema.index({ createdAt: -1 });

export default mongoose.model("CouponModel", couponSchema);
