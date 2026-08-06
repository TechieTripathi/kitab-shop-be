import express from "express";
import {
	login,
	RefreshToken,
	CreateUser,
	ForgetPassword,
	ResetPassword,
	EmailVerfily,
	ResendVerificationEmail,
	GoogleLogin,
	Logout,
	DeleteMyAccount,
	UpdateAdminTwoFactor,
	VerifyAdminTwoFactor,
} from "./auth.controller.js";

import { TokenVerify } from "../../middleware/auth.middleware.js";
import { authRateLimit } from "../../middleware/rate-limit.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
	emailVerifySchema,
	forgotPasswordSchema,
	googleLoginSchema,
	loginSchema,
	resendVerificationSchema,
	resetPasswordSchema,
	signupSchema,
	verifyTwoFactorSchema,
} from "./auth.schema.js";
const router = express.Router();

// Every credential-bearing endpoint, not just login. Signup, email verification
// and the 2FA challenge are all brute-forceable and were previously unlimited.
router.use(
	[
		"/login",
		"/google",
		"/forgot-password",
		"/reset-password",
		"/create",
		"/email-verify",
		"/resend-verification",
		"/2fa/verify",
	],
	authRateLimit
);
// /refresh-token is deliberately excluded: it is guarded by a signed token
// rather than a guessable secret, and limiting it per-IP would sign out
// legitimate users who share an address behind NAT.

router.get("/", (req, res) => {
	res.send("hello world");
});

router.post("/create", validate(signupSchema), CreateUser);

router.post("/email-verify", validate(emailVerifySchema), EmailVerfily);
router.post(
	"/resend-verification",
	validate(resendVerificationSchema),
	ResendVerificationEmail
);

router.post("/login", validate(loginSchema), login);
router.post("/google", validate(googleLoginSchema), GoogleLogin);
router.post("/logout", TokenVerify, Logout);
router.post("/2fa/verify", validate(verifyTwoFactorSchema), VerifyAdminTwoFactor);
router.patch("/2fa/admin", TokenVerify, UpdateAdminTwoFactor);
router.delete("/me", TokenVerify, DeleteMyAccount);

router.post("/forgot-password", validate(forgotPasswordSchema), ForgetPassword);

router.post("/reset-password", validate(resetPasswordSchema), ResetPassword);
// router.post("/Token-testing", TokenVerify, (req, res) => {
//   res.send(req.user.id);
// });

router.get("/refresh-token", RefreshToken);
router.post("/refresh-token", RefreshToken);

export default router;
