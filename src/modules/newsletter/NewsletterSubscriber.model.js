import mongoose from "mongoose";

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 254,
    },
  },
  { timestamps: true },
);

export default mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
