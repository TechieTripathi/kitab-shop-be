import mongoose from "mongoose";

const Categoty = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    tagline: {
      type: String,
      required: true,
    },
    themecolor: {
      type: String,
      required: true,
      default: "#000000",
    },

    bestseller: {
      type: Boolean,
      default: false,
    },

    styles: {
      name: {
        fontFamily: { type: String, default: "default" },
        fontSize: { type: Number, default: 14, min: 1, max: 96 },
        fontWeight: { type: String, default: "semibold" },
        fontStyle: { type: String, default: "normal" },
        textColor: { type: String, default: "#1F2937" },
      },
      tagline: {
        fontFamily: { type: String, default: "default" },
        fontSize: { type: Number, default: 13, min: 1, max: 64 },
        fontWeight: { type: String, default: "normal" },
        fontStyle: { type: String, default: "normal" },
        textColor: { type: String, default: "#4B5563" },
      },
    },

    image: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
    },
  },

  {
    timestamps: true,
  },
);

export default mongoose.model("Category", Categoty);

// name;
// tagline;

// themecolore;

// image;
