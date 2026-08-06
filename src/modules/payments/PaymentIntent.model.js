import mongoose from "mongoose";

const paymentItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      required: true,
    },
    name: { type: String, required: true },
    image: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    selectedVariants: { type: Map, of: String, default: {} },
    variantKey: { type: String, default: "" },
  },
  { _id: false },
);

const paymentIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: "INR",
    },
    items: {
      type: [paymentItemSchema],
      required: true,
    },
    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: "India" },
    },
    subtotal: { type: Number, required: true, min: 0 },
    shippingCharge: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    walletDiscount: { type: Number, default: 0, min: 0 },
    couponDiscount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    coupon: { type: String, default: null },
    status: {
      type: String,
      enum: ["created", "processing", "completed", "failed", "refunded", "expired"],
      default: "created",
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    stockReserved: {
      type: Boolean,
      default: false,
    },
    storeOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      default: null,
    },
    failureReason: { type: String, default: "" },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

paymentIntentSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

export default mongoose.model("PaymentIntent", paymentIntentSchema);
