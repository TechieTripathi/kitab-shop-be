import nodemailer from "nodemailer";

import dotenv from "dotenv";

dotenv.config();
// const html = emailTemplate.replace("{{verificationLink}}", verificationLink);
export const SendEmail = async (email, token) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // ✅ SMTP config add kiya
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password.html?token=${token}`;

    await transporter.sendMail({
      from: `"Astro Wala Shop" <${process.env.EMAIL}>`,
      replyTo: process.env.EMAIL,
      to: email,
      subject: "Reset Your Password",
      text: `Reset Your Password\n\nWe received a request to reset your password. Click the link below to create a new password:\n\n${resetLink}\n\nIf you did not request this, please ignore this email.`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9f9f9; font-family: Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; color: #333; border: 1px solid #eeeeee; border-radius: 8px;">
    <h1 style="color: #2563eb; text-align: center; font-size: 24px; margin-bottom: 24px;">Reset Your Password</h1>
    
    <p style="text-align: center; font-size: 16px; margin-bottom: 24px; color: #555;">
      We received a request to reset your password.
    </p>
    
    <p style="text-align: center; font-size: 16px; margin-bottom: 32px; color: #555;">
      Click the button below to create a new password.
    </p>
    
    <div style="text-align: center; margin-bottom: 40px;">
      <a href="${resetLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
    </div>
    
    <p style="text-align: center; font-size: 14px; color: #777; margin-bottom: 12px;">
      If the button does not work, copy and paste this link into your browser:
    </p>
    
    <p style="text-align: center; font-size: 14px; margin-bottom: 0; word-break: break-all;">
      <a href="${resetLink}" style="color: #2563eb; text-decoration: underline;">${resetLink}</a>
    </p>
  </div>
</body>
</html>`,
    });

    console.log("Email sent successfully! ✅");
  } catch (ex) {
    console.error("Error sending email:", ex);
  }
};
export default SendEmail;
