import crypto from "crypto";
import CodVerification from "./CodVerification.model.js";
import UserModel from "../../model/User.model.js";
import { CreateharhPassword, VerfiyPaswword } from "../../passwordhash/password.js";
import { SendCodOtpEmail } from "./send-cod-otp-email.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;

// Placeholder for once a paid SMS provider (e.g. Twilio/MSG91) is purchased —
// wire the real API call in here and switch the default channel below. Kept
// as a real branch (not just a comment) so the rest of the OTP flow already
// works unchanged the day this is filled in.
const sendCodOtpBySms = async () => {
  throw Object.assign(new Error("SMS verification is not available yet — use email."), {
    statusCode: 400,
  });
};

export const SendCodOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    // req.user comes from the JWT + a deliberately narrow DB lookup in
    // TokenVerify (roles/isActive/isBlocked only) — it never carries email,
    // so it has to be fetched separately here.
    const userRecord = await UserModel.findById(userId).select("email");
    const email = String(userRecord?.email || "").trim().toLowerCase();
    const channel = req.body?.channel === "sms" ? "sms" : "email";

    if (!email) {
      return res.status(400).json({ success: false, message: "Your account has no email on file." });
    }

    const recent = await CodVerification.findOne({ userId, channel }).sort({ createdAt: -1 });
    if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds}s before requesting another code.`,
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = await CreateharhPassword(otp);

    // The raw SMTP/provider error must never reach the checkout UI ("535
    // Username and Password not accepted" in red under the OTP box). A send
    // failure is a temporary infrastructure problem — say that, honestly.
    try {
      if (channel === "sms") {
        await sendCodOtpBySms(req.user, otp);
      } else {
        await SendCodOtpEmail(email, otp);
      }
    } catch {
      return res.status(502).json({
        success: false,
        message: "We could not send the verification code right now. Please try again in a moment, or pay online instead.",
      });
    }

    await CodVerification.create({ userId, email, channel, otpHash });

    return res.status(200).json({
      success: true,
      message: `A verification code was sent to ${email}.`,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const VerifyCodOtp = async (req, res) => {
  try {
    const userId = req.user.id;
    const otp = String(req.body?.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit code." });
    }

    const record = await CodVerification.findOne({ userId, isVerified: false }).sort({ createdAt: -1 });
    if (!record) {
      return res.status(400).json({ success: false, message: "Request a new code before verifying." });
    }

    if (Date.now() - record.createdAt.getTime() > OTP_TTL_MS) {
      return res.status(400).json({ success: false, message: "This code has expired. Please request a new one." });
    }

    const isValid = await VerfiyPaswword(otp, record.otpHash);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Incorrect code. Please try again." });
    }

    record.isVerified = true;
    record.verifiedAt = new Date();
    await record.save();

    return res.status(200).json({ success: true, message: "Verified — you can place your Cash on Delivery order." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
