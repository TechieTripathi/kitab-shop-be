import mango from "mongoose";
const productSchema = new mango.Schema(
  {
    category_id: {
      type: mango.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    mrp: {
      type: Number,
      default: function () {
        return this.price;
      },
      min: 0,
    },

    size: {
      type: String,
      default: "Standard",
    },

    producthightlight: {
      type: String,
      required: true,
    },

    styles: {
      name: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 14, min: 1, max: 96 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#1F2937" },
      },
      brand: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 12, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#6B7280" },
      },
      price: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 18, min: 1, max: 96 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "bold" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#111827" },
      },
      highlights: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 14, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#4B5563" },
      },
      description: {
        fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
        fontSize: { type: Number, default: 14, min: 1, max: 64 },
        fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
        fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
        textColor: { type: String, default: "#4B5563" },
      },
    },

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    variants: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          sku: { type: String, trim: true, default: "" },
          attributes: {
            type: Map,
            of: String,
            default: {},
          },
          price: { type: Number, min: 0, default: null },
          mrp: { type: Number, min: 0, default: null },
          stock: { type: Number, min: 0, default: 0 },
          reservedStock: { type: Number, min: 0, default: 0 },
          active: { type: Boolean, default: true },
        },
      ],
      default: [],
    },

    viewCount: {
      type: Number,
      default: 0,
    },

    bestseller: {
      type: Boolean,
      default: false,
    },

    brand: {
      type: String,
      required: true,
    },

    image: {
      type: String,
      required: true,
    },

    public_id: {
      type: String,
    },

    // SEO fields. The admin product form and the storefront product page both
    // already read and write these; they had no schema here, so Mongoose was
    // silently dropping whatever the admin typed.
    metaTitle: {
      type: String,
      trim: true,
      default: "",
      maxlength: 160,
    },

    metaDescription: {
      type: String,
      trim: true,
      default: "",
      maxlength: 320,
    },

    metaKeywords: {
      type: [String],
      default: [],
    },

    // Optional human-readable URL segment, stored for sitemap and future
    // slug-based routing. Indexed but deliberately not unique: the storefront
    // still routes products by id, and a unique index would turn two products
    // sharing a name into a failed create rather than a cosmetic duplicate.
    // Promote this to a unique index at the same time as slug routing.
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

productSchema.index({ bestseller: 1, category_id: 1 });
productSchema.index({ viewCount: -1 });
productSchema.index({ name: "text", brand: "text", producthightlight: "text", description: "text" });

export default mango.model("ProductModel", productSchema, "products");
