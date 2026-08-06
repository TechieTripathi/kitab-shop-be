import mongoose from "mongoose";

const userProfileSchema = new mongoose.Schema(
  {
    userid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel", // Authentication Model
      required: true,
      unique: true,
    },

    referralCode: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAuthenticationModel",
      default: null,
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalReferrals: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalWalletCreditEarned: {
      type: Number,
      default: 0,
      min: 0,
    },

    fullName: {
      type: String,
      trim: true,
      default: "",
    },

    firstName: {
      type: String,
      trim: true,
      default: "",
    },

    middleName: {
      type: String,
      trim: true,
      default: "",
    },

    lastName: {
      type: String,
      trim: true,
      default: "",
    },

    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },

    avatar: {
      type: String,
      default: "",
    },

    avatarPublicId: {
      type: String,
      default: "",
    },

    bio: {
      type: String,
      default: "",
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    dob: {
      type: Date,
    },

    address: {
      addressLine1: {
        type: String,
        trim: true,
        default: "",
      },

      addressLine2: {
        type: String,
        trim: true,
        default: "",
      },

      city: {
        type: String,
        trim: true,
        default: "",
      },

      state: {
        type: String,
        trim: true,
        default: "",
      },

      pincode: {
        type: String,
        trim: true,
        default: "",
      },

      country: {
        type: String,
        default: "India",
        trim: true,
      },
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("UserProfile", userProfileSchema);
