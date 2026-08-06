import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      required: true,
      unique: true, // One cart per user
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ProductModel",
          required: true,
        },
        quantity: {
          type: Number,
          default: 1,
          min: 1,
        },
        selectedVariants: {
          type: Map,
          of: String,
          default: {},
        },
        variantKey: {
          type: String,
          default: "",
        },
        price: {
          type: Number,
          min: 0,
        },
        mrp: {
          type: Number,
          min: 0,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Cart", cartSchema);
