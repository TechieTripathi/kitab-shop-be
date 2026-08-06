import { boundedString, looseBody, z } from "../../middleware/validate.middleware.js";

// Controllers read `Email`/`Password` with capitals, so the schema matches the
// wire format rather than renaming it.
const email = z
  .string({ error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .email("Enter a valid email address")
  .toLowerCase();

// Length only. Strength rules stay in the controller behind
// AUTH_SECURITY_ENABLED so this schema does not silently enforce a policy the
// toggle is meant to control.
const password = z
  .string({ error: "Password is required" })
  .min(1, "Password is required")
  .max(200, "Password is too long");

export const signupSchema = {
  body: looseBody({
    Email: email,
    Password: password,
    referralCode: boundedString({ label: "Referral code", max: 40 })
      .optional()
      .or(z.literal("")),
  }),
};

// Login checks presence and length but deliberately not address format: format
// checking on login adds no security and would lock out any existing account
// whose stored email predates the signup rules.
export const loginSchema = {
  body: looseBody({
    Email: boundedString({ label: "Email", max: 254 }).toLowerCase(),
    Password: password,
  }),
};

export const googleLoginSchema = {
  body: looseBody({
    credential: boundedString({ label: "Google credential", max: 4000 }),
  }),
};

export const forgotPasswordSchema = {
  body: looseBody({
    email,
  }),
};

export const resetPasswordSchema = {
  body: looseBody({
    resetToken: boundedString({ label: "Reset token", max: 500 }),
    password,
  }),
};

// Either a link `token`, or an `email` + `otp` pair — the controller decides
// which path applies, so every field here is optional at the schema level.
export const emailVerifySchema = {
  body: looseBody({
    token: boundedString({ label: "Token", max: 256 }).optional(),
    email: email.optional(),
    otp: boundedString({ label: "Code", min: 6, max: 6 }).optional(),
  }),
};

export const resendVerificationSchema = {
  body: looseBody({
    email,
  }),
};

export const verifyTwoFactorSchema = {
  body: looseBody({
    challengeId: boundedString({ label: "Challenge id", max: 200 }),
    code: boundedString({ label: "Code", min: 4, max: 10 }),
  }),
};
