import mongoose from "mongoose";

const contactMessageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: "",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 2000,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },
    userEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["unread", "read"],
      default: "unread",
      index: true,
    },
    replies: [
      {
        message: {
          type: String,
          required: true,
          trim: true,
          maxlength: 2000,
        },
        admin: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "UserAuthenticationModel",
          default: null,
        },
        adminEmail: {
          type: String,
          trim: true,
          lowercase: true,
          default: "",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true },
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ email: 1, createdAt: -1 });
contactMessageSchema.index({ subject: 1, createdAt: -1 });

export default mongoose.model("ContactMessage", contactMessageSchema);
