import mongoose from "mongoose";

const FontSchema = new mongoose.Schema(
  {
    fontFamily: { type: String, enum: ["default", "serif", "sans", "mono"], default: "default" },
    fontSize: { type: Number, default: 14, min: 1, max: 96 },
    fontWeight: { type: String, enum: ["normal", "medium", "semibold", "bold"], default: "normal" },
    fontStyle: { type: String, enum: ["normal", "italic"], default: "normal" },
    textColor: { type: String, default: "#4B5563" },
  },
  { _id: false },
);

const TextBlockSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    font: { type: FontSchema, default: () => ({}) },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const SectionSchema = new mongoose.Schema(
  {
    heading: { type: String, default: "" },
    body: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    headingFont: { type: FontSchema, default: () => ({ fontSize: 24, fontWeight: "bold", textColor: "#111827" }) },
    bodyFont: { type: FontSchema, default: () => ({}) },
  },
  { _id: false },
);

const LinkButtonSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    link: { type: String, default: "/" },
    enabled: { type: Boolean, default: true },
    font: { type: FontSchema, default: () => ({ fontSize: 14, fontWeight: "bold", textColor: "#111827" }) },
  },
  { _id: false },
);

const AboutPageSchema = new mongoose.Schema(
  {
    key: { type: String, default: "about", unique: true, index: true },
    heroImage: {
      url: { type: String, default: "/Gemini_Generated_Image_89fz9b89fz9b89fz.webp" },
      enabled: { type: Boolean, default: true },
    },
    secondaryImage: {
      url: { type: String, default: "/Gemini_Generated_Image_89fz9b89fz9b89fz.webp" },
      enabled: { type: Boolean, default: true },
    },
    title: {
      type: TextBlockSchema,
      default: () => ({
        text: "About Astro Wala Shop",
        font: { fontSize: 34, fontWeight: "bold", textColor: "#FFFFFF" },
      }),
    },
    intro: {
      type: TextBlockSchema,
      default: () => ({
        text: "Astro Wala Shop is India's trusted destination for certified astrology products, spiritual essentials, and reliable customer support.",
        font: { fontSize: 16, fontWeight: "normal", textColor: "#EFF6FF" },
      }),
    },
    primaryButton: { type: LinkButtonSchema, default: () => ({ text: "Explore Products", link: "/products" }) },
    secondaryButton: { type: LinkButtonSchema, default: () => ({ text: "Contact Support", link: "/contact", textColor: "#FFFFFF" }) },
    sections: {
      type: [SectionSchema],
      default: () => [
        {
          heading: "Who we are",
          body: "Astro Wala Shop brings together certified gemstones, authentic rudraksha, energised yantras, pooja essentials, healing crystals, and astrology guidance on one trusted platform. Our goal is to make spiritual shopping simple, transparent, and dependable for every customer.",
        },
        {
          heading: "What we promise",
          body: "We focus on clear product details, honest pricing, careful packaging, and responsive support. Wherever certification or verification is required, we make sure the customer receives the right information before making a purchase decision.",
        },
      ],
    },
    processSteps: {
      type: [SectionSchema],
      default: () => [
        { heading: "Choose the right category", body: "Explore gemstones, rudraksha, yantras, puja essentials, healing crystals, and astrology items with clear product details." },
        { heading: "Check trust details", body: "Review price, size, delivery availability, return eligibility, certification notes, and product highlights before checkout." },
        { heading: "Order with support", body: "After checkout, order status, invoice, returns, refunds, and customer support are available from the account area." },
      ],
    },
    qualityPoints: {
      type: [TextBlockSchema],
      default: () => [
        { text: "Product information is kept easy to read and transparent." },
        { text: "Important buying details are shown before checkout." },
        { text: "Orders are packed carefully for safe delivery." },
        { text: "Support is available for order, product, return, and refund questions." },
      ],
    },
    lastEditedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
    },
  },
  { timestamps: true },
);

export default mongoose.model("AboutPage", AboutPageSchema);
