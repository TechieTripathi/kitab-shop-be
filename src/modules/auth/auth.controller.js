import {
  generateAccessToken,
  generateRefreshToken,
} from "./token.js";
import jwt from "jsonwebtoken";

import bcrypt from "bcrypt";
import crypto from "crypto";

import emailverificationmodel from "../../model/emailverification.model.js";

// import CreateHashPassword from "../passwordhash/password.js";

// import verfilypass from "../passwordhash/password.js";
import {
  CreateharhPassword,
  VerfiyPaswword,
} from "../../passwordhash/password.js";

import sendEmail from "../../utils/email.js";
import UserModel from "../../model/User.model.js";
import AdminTwoFactorChallenge from "../../model/AdminTwoFactorChallenge.model.js";
import UserProfile from "../profiles/UserProfile.model.js";
import { SendVerficationEmail } from "./send-verfication-email.js";
import {
  CloseLoginActivity,
  CreateLoginActivity,
} from "../login-activity/login-activity.controller.js";
import CouponModel from "../coupons/coupon.model.js";
import ReferralSetting from "../referral/ReferralSetting.model.js";
import { isAuthSecurityEnabled } from "../../config/features.config.js";
import {
  getPrimaryRole,
  getUserPermissions,
  hasAdminRole,
  normalizeRoles,
} from "../../config/admin-permissions.config.js";
import { isTokenRevoked, revokeToken } from "./token-revocation.service.js";
import { verifyGoogleCredential } from "./google-auth.service.js";
import {
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from "./refresh-cookie.js";

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hashPasswordResetToken = (resetToken) =>
  crypto.createHash("sha256").update(String(resetToken)).digest("hex");

const getPasswordResetTokenTtlMs = () => {
  const configuredMinutes = Number.parseInt(
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    10,
  );
  const ttlMinutes =
    Number.isInteger(configuredMinutes) && configuredMinutes > 0
      ? Math.min(configuredMinutes, 1440)
      : 15;

  return ttlMinutes * 60 * 1000;
};

const createReferralSignupCoupon = async ({ user, settings }) => {
  const referralSettings = settings || await ReferralSetting.getSettings();
  const isPercentage = referralSettings.signupDiscountType === "percentage";

  await CouponModel.create({
    targetType: "all",
    discountType: referralSettings.signupDiscountType || "fixed",
    discountValue: referralSettings.signupDiscountAmount,
    startDate: new Date(),
    expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    maxLimit: 1,
    minPurchaseAmount: isPercentage ? 0 : referralSettings.signupDiscountAmount,
    assignedUser: user._id,
    customerEmail: user.email,
    isActive: true,
  });
};

const findReferrerByCode = async (referralCode) => {
  const requestedReferralCode = String(referralCode || "").trim().toUpperCase();
  if (!requestedReferralCode) return null;

  const referrerProfile = await UserProfile.findOne({ referralCode: requestedReferralCode });
  if (!referrerProfile) {
    const error = new Error("Invalid referral code");
    error.statusCode = 400;
    throw error;
  }

  return referrerProfile.userid;
};

const findUserByEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return UserModel.findOne({
    email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
  });
};

const getProfileDisplayName = (profile) => {
  if (!profile) return "";

  return (
    profile.fullName ||
    [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()
  );
};

const verifyStoredPassword = async (password, storedPassword) => {
  if (!password || !storedPassword) return false;

  if (await VerfiyPaswword(password, storedPassword)) return true;

  try {
    return await bcrypt.compare(password, storedPassword);
  } catch {
    return false;
  }
};

const buildLoginResponse = async (req, res, user) => {
  const roles = normalizeRoles(user);
  const primaryRole = getPrimaryRole(user);
  const accessToken = generateAccessToken(user.id, primaryRole, roles);
  const refreshToken = generateRefreshToken(user.id, primaryRole, roles);
  const profile = await UserProfile.findOne({ userid: user.id }).select(
    "fullName firstName middleName lastName",
  );
  const displayName = getProfileDisplayName(profile);
  const loginActivity = await CreateLoginActivity(req, user.id);

  setRefreshTokenCookie(res, refreshToken);

  return res.status(200).json({
    message: "Login successful",
    user: {
      id: user.id,
      email: user.email,
      name: displayName,
      fullName: displayName,
      role: primaryRole,
      roles,
      permissions: hasAdminRole({ roles }) ? getUserPermissions(user) : [],
    },
    token: {
      accessToken,
      refreshToken,
    },
    loginActivityId: loginActivity?._id || null,
  });
};

const createEmailVerification = async (user, email) => {
  const token = crypto.randomBytes(64).toString("hex");
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = await CreateharhPassword(otp);

  await emailverificationmodel.create({
    userId: user._id,
    token,
    otpHash,
    email,
    isUsed: false,
    createdAt: new Date(),
  });

  await SendVerficationEmail(email, token, otp);
};

const buildTwoFactorChallenge = async (user) => {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await CreateharhPassword(code);
  const challenge = await AdminTwoFactorChallenge.create({
    user: user._id,
    codeHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  return { challenge, code };
};

export const login = async (req, res) => {
  try {
    const { Email, Password } = req.body;
    const email = normalizeEmail(Email);

    // Validate input
    if (!email || !Password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(400).json({
        message: "User not found",
      });
    }

    if (user.isBlocked === true) {
      return res.status(403).json({
        message: "Your account is blocked. Please contact support.",
      });
    }

    // Accounts created by the old signup flow used isActive=false for
    // unverified users. They were never admin-blocked and can be repaired.
    if (user.isActive === false) {
      user.isActive = true;
      await user.save();
    }

    // Find user by email
    // const { data: user, error } = await supabase
    //   .from("UserModel")
    //   .select("*")
    //   .eq("Email", email)
    //   .single();

    // if (error || !user) {
    //   return res.status(401).json({
    //     message: "User not found in sql",
    //   });
    // }

    // Verify password

    const isPasswordValid = await verifyStoredPassword(Password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Generate tokens

    if (user.isVerified === false) {
      return res.status(401).json({
        message:
          "Please verify your email first — check your inbox for the verification link, or use 'Resend verification email' below.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    if (
      isAuthSecurityEnabled() &&
      hasAdminRole(user) &&
      user.adminTwoFactorEnabled
    ) {
      const { challenge, code } = await buildTwoFactorChallenge(user);
      return res.status(202).json({
        success: true,
        requiresTwoFactor: true,
        challengeId: challenge._id,
        message: "Two-factor verification is required",
        ...(process.env.NODE_ENV !== "production" ? { demoCode: code } : {}),
      });
    }
    return buildLoginResponse(req, res, user);
  } catch (ex) {
    console.error(ex);

    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const GoogleLogin = async (req, res) => {
  try {
    const profile = await verifyGoogleCredential(req.body?.credential);
    if (!profile.email) {
      return res
        .status(400)
        .json({ message: "Google account email was not provided" });
    }

    let user = await findUserByEmail(profile.email);
    if (user?.isBlocked === true) {
      return res.status(403).json({
        message: "Your account is blocked. Please contact support.",
      });
    }

    const isNewUser = !user;
    const referredByForNewUser = isNewUser
      ? await findReferrerByCode(req.body?.referralCode)
      : null;

    if (!user) {
      const randomPassword = await CreateharhPassword(
        `google:${profile.googleId}:${crypto.randomBytes(24).toString("hex")}`,
      );
      user = await UserModel.create({
        email: profile.email,
        password: randomPassword,
        roles: ["user"],
        isActive: true,
        isBlocked: false,
        isVerified: true,
      });
    } else {
      user.isActive = true;
      user.isVerified = true;
      await user.save();
    }

    const existingProfile = await UserProfile.findOne({ userid: user._id });
    if (!existingProfile) {
      // Same referral attribution as the email/password signup path
      // (CreateUser) — a referral code only means anything at first signup,
      // so this is skipped entirely for an existing profile below.
      const referredBy = isNewUser
        ? referredByForNewUser
        : await findReferrerByCode(req.body?.referralCode);

      await UserProfile.create({
        userid: user._id,
        referralCode: `KITAB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        referredBy,
        fullName: profile.name,
        firstName: profile.firstName,
        lastName: profile.lastName,
        avatar: profile.avatar,
      });

      if (referredBy) {
        await createReferralSignupCoupon({ user });
      }
    } else {
      if (profile.name && !existingProfile.fullName)
        existingProfile.fullName = profile.name;
      if (profile.firstName && !existingProfile.firstName)
        existingProfile.firstName = profile.firstName;
      if (profile.lastName && !existingProfile.lastName)
        existingProfile.lastName = profile.lastName;
      if (profile.avatar && !existingProfile.avatar)
        existingProfile.avatar = profile.avatar;
      await existingProfile.save();
    }

    return buildLoginResponse(req, res, user);
  } catch (error) {
    return res.status(401).json({
      message: error.message || "Google login failed",
    });
  }
};

export const Logout = async (req, res) => {
  try {
    const { loginActivityId, refreshToken } = req.body || {};
    const activity = await CloseLoginActivity(req.user.id, loginActivityId);
    const tokenForRevocation = refreshToken || getRefreshTokenFromCookie(req);
    if (isAuthSecurityEnabled()) {
      await revokeToken({
        token: req.authToken,
        userId: req.user.id,
        tokenType: "access",
        reason: "logout",
      });
      if (tokenForRevocation) {
        await revokeToken({
          token: tokenForRevocation,
          userId: req.user.id,
          tokenType: "refresh",
          reason: "logout",
        });
      }
    }
    clearRefreshTokenCookie(res);

    return res.status(200).json({
      success: true,
      message: "Logout successful",
      activityClosed: Boolean(activity),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const VerifyAdminTwoFactor = async (req, res) => {
  try {
    if (!isAuthSecurityEnabled()) {
      return res.status(404).json({ message: "Two-factor auth is disabled" });
    }

    const { challengeId, code } = req.body || {};
    if (!challengeId || !code) {
      return res.status(400).json({ message: "Challenge id and code are required" });
    }

    const challenge = await AdminTwoFactorChallenge.findOne({
      _id: challengeId,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) {
      return res.status(401).json({ message: "Invalid or expired challenge" });
    }

    const isValid = await VerfiyPaswword(String(code), challenge.codeHash);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid verification code" });
    }

    const user = await UserModel.findById(challenge.user);
    if (!user || user.isBlocked || user.isActive === false) {
      return res.status(403).json({ message: "Account access is blocked" });
    }

    challenge.consumedAt = new Date();
    await challenge.save();

    return buildLoginResponse(req, res, user);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const UpdateAdminTwoFactor = async (req, res) => {
  try {
    if (!isAuthSecurityEnabled()) {
      return res.status(404).json({ message: "Two-factor auth is disabled" });
    }
    if (!hasAdminRole(req.user)) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const enabled = Boolean(req.body?.enabled);
    const user = await UserModel.findByIdAndUpdate(
      req.user.id,
      { adminTwoFactorEnabled: enabled },
      { returnDocument: "after" },
    ).select("email adminTwoFactorEnabled");

    return res.status(200).json({
      success: true,
      message: enabled ? "Admin 2FA enabled" : "Admin 2FA disabled",
      user,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const DeleteMyAccount = async (req, res) => {
  try {
    if (!isAuthSecurityEnabled()) {
      return res.status(404).json({ message: "Account deletion is disabled" });
    }

    await UserModel.findByIdAndUpdate(req.user.id, {
      isActive: false,
      isBlocked: true,
      deletedAt: new Date(),
      email: `deleted-${req.user.id}-${Date.now()}@deleted.local`,
    });
    await revokeToken({
      token: req.authToken,
      userId: req.user.id,
      tokenType: "access",
      reason: "account_deleted",
    });

    return res.status(200).json({
      success: true,
      message: "Account deleted",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const CreateUser = async (req, res) => {
  try {
    const { Email, Password, referralCode } = req.body;
    const email = normalizeEmail(Email);

    // 1. Validate request
    if (!email || !Password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (isAuthSecurityEnabled()) {
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ message: "Enter a valid email address" });
      }

      if (String(Password).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        });
      }
    }

    // 2. Check if user already exists
    const existingUser = await CheckUser(email);

    if (existingUser) {
      if (existingUser.isVerified === false) {
        return res.status(409).json({
          message:
            "This account already exists but is not verified yet. Please verify your email to continue.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }

      return res.status(409).json({
        message: "User already exists",
      });
    }

    // Check referral code before creating the user. If the code is invalid, no
    // orphan auth row should be left behind.
    const referredBy = await findReferrerByCode(referralCode);

    // 3. Hash password
    const hashedPassword = await CreateharhPassword(Password);

    // 4. Create user
    const user = await UserModel.create({
      email,
      password: hashedPassword,
      roles: ["user"],
      isActive: true,
      isBlocked: false,
      isVerified: false,
    });

    if (!user) {
      return res.status(500).json({
        message: "User creation failed",
      });
    }

    // Create user profile with their own new referral code
    const myReferralCode = `KITAB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    await UserProfile.create({
      userid: user._id,
      referralCode: myReferralCode,
      referredBy: referredBy,
    });

    // If referred, create a coupon for this new user based on Admin settings
    if (referredBy) {
      await createReferralSignupCoupon({ user });
    }

    // 5. Create verification token/OTP and send them in one email. A send
    // failure must not pretend the mail went out — the account exists but the
    // customer needs to know to use "Resend verification" instead of waiting
    // for an email that never comes.
    let emailSent = true;
    try {
      await createEmailVerification(user, email);
    } catch {
      emailSent = false;
    }

    // 6. Remove password from response
    const { password, ...userData } = user.toObject();

    // 7. Success response
    return res.status(201).json({
      message: emailSent
        ? "User created successfully. Please verify your email."
        : "Account created, but the verification email could not be sent right now. Please use 'Resend verification email' from the login page in a minute.",
      emailSent,
      user: userData,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      message: error.message,
    });
  }
};

async function CheckUser(email) {
  try {
    const user = await findUserByEmail(email);

    return user;
  } catch (error) {
    console.log("DB Error:", error);
    return null;
  }
}

export const EmailVerfily = async (req, res) => {
  try {
    const token = req.body?.token || req.headers["x-verification-token"];
    const email = normalizeEmail(req.body?.email);
    const otp = req.body?.otp;

    if (!token && !(email && otp)) {
      return res.status(400).json({
        message: "A verification link or email and code are required",
      });
    }

    // Find the matching verification record, either by the link's token or
    // by the most recent OTP issued for that email.
    let emailVerification;
    if (token) {
      emailVerification = await emailverificationmodel.findOne({ token });
      if (!emailVerification) {
        return res.status(400).json({
          message: "Invalid or expired verification link",
        });
      }
    } else {
      emailVerification = await emailverificationmodel
        .findOne({ email, isUsed: false })
        .sort({ createdAt: -1 });

      const isValidOtp =
        emailVerification &&
        (await VerfiyPaswword(String(otp), emailVerification.otpHash));

      if (!isValidOtp) {
        return res.status(400).json({
          message: "Invalid or expired code",
        });
      }
    }

    if (emailVerification.isUsed) {
      return res.status(400).json({
        message: "Email already verified",
      });
    }

    // Update user
    const user = await UserModel.findByIdAndUpdate(
      emailVerification.userId,
      {
        isVerified: true,
        isActive: true,
        isBlocked: false,
        blockedAt: null,
      },
      { returnDocument: "after" },
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Mark verification record as used (link and OTP both point at the same
    // record, so either path consumes both).
    await emailverificationmodel.findByIdAndUpdate(emailVerification._id, {
      isUsed: true,
    });

    return res.status(200).json({
      message: "Email verified successfully",
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const ResendVerificationEmail = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        message: "Email is already verified",
      });
    }

    // Invalidate any earlier unused link/OTP for this email before issuing a
    // new one, so only the latest email can verify the account.
    await emailverificationmodel.deleteMany({ email, isUsed: false });

    try {
      await createEmailVerification(user, email);
    } catch {
      return res.status(502).json({
        message:
          "We could not send the verification email right now. Please try again in a few minutes.",
      });
    }

    return res.status(200).json({
      message: "Verification email sent. Please check your inbox.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const ForgetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const resetToken = crypto.randomBytes(64).toString("hex");
    const passwordResetTokenHash = hashPasswordResetToken(resetToken);
    const passwordResetTokenExpiresAt = new Date(
      Date.now() + getPasswordResetTokenTtlMs(),
    );

    // Use the native collection update so any legacy plaintext token is
    // removed even after the old Resettoken path is removed from the schema.
    await UserModel.collection.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash,
          passwordResetTokenExpiresAt,
        },
        $unset: { Resettoken: "" },
      },
    );

    await sendEmail(user.email, resetToken);

    console.log(`Password reset email sent to ${resetToken}`);

    return res.status(200).json({
      message: "Password reset email sent successfully.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};
export const ResetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;

    // Validate request
    if (!resetToken || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const hashedPassword = await CreateharhPassword(password);
    const passwordResetTokenHash = hashPasswordResetToken(resetToken);

    // Matching and clearing in one database operation prevents the same
    // one-time token from succeeding in two concurrent requests.
    const user = await UserModel.findOneAndUpdate(
      {
        passwordResetTokenHash,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      },
      {
        $set: { password: hashedPassword },
        $unset: {
          passwordResetTokenHash: "",
          passwordResetTokenExpiresAt: "",
          Resettoken: "",
        },
      },
      { returnDocument: "after" },
    );

    if (!user) {
      return res.status(404).json({
        message: "Invalid or expired reset token",
      });
    }

    return res.status(200).json({
      message: "Password reset successfully.",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const RefreshToken = async (req, res) => {
  try {
    const refreshToken =
      req.body?.refreshToken ||
      req.query?.refreshToken ||
      req.headers["x-refresh-token"] ||
      getRefreshTokenFromCookie(req);

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const decoded = jwt.verify(refreshToken, process.env.refresh_token);
    if (isAuthSecurityEnabled() && (await isTokenRevoked(refreshToken))) {
      return res.status(401).json({ message: "Refresh token has been revoked" });
    }
    const user = await UserModel.findById(decoded.id).select(
      "role roles isActive isBlocked",
    );

    if (!user || user.isBlocked === true || user.isActive === false) {
      return res.status(403).json({
        message: "Account access is blocked",
      });
    }

    const roles = normalizeRoles(user);
    const primaryRole = getPrimaryRole(user);
    const newAccessToken = generateAccessToken(user.id, primaryRole, roles);
    const newRefreshToken = generateRefreshToken(user.id, primaryRole, roles);
    if (isAuthSecurityEnabled()) {
      await revokeToken({
        token: refreshToken,
        userId: user.id,
        tokenType: "refresh",
        reason: "refresh_rotation",
      });
    }

    setRefreshTokenCookie(res, newRefreshToken);

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    return res.status(401).json({ message: error.message });
  }
};
