import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductModel",
      required: true,
      unique: true,
      index: true,
    },

    stock: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["In Stock", "Out of Stock"],
      default: "In Stock",
    },

    history: [
      {
        previousStock: { type: Number, required: true },
        newStock: { type: Number, required: true },
        change: { type: Number, required: true },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "UserAuthenticationModel",
        },
        note: {
          type: String,
          default: "Manual stock update",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

inventorySchema.pre("save", function () {
  this.status = this.stock === 0 ? "Out of Stock" : "In Stock";
});

inventorySchema.index({ updatedAt: -1 });

export default mongoose.model("InventoryModel", inventorySchema);
