import mongoose from "mongoose";
import {
  VALID_USER_ROLES,
  normalizeRoles,
} from "../config/admin-permissions.config.js";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },

    roles: {
      type: [String],
      enum: VALID_USER_ROLES,
      default: ["user"],
    },
    Resettoken: String,
    resetTokenExpiresAt: Date,

    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    adminTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.pre("validate", function normalizeUserRoles() {
  this.roles = normalizeRoles(this);
});

export default mongoose.model("UserAuthenticationModel", UserSchema, "users");
