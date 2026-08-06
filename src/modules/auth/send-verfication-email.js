import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

export const SendVerficationEmail = async (email, token, otp) => {
  try {
    // Frontend URL
    const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    // Create HTML template directly to avoid Vercel filesystem issues
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Verify Email</title>
  </head>
  <body
    style="
      font-family: Arial, sans-serif;
      background: #f5f5f5;
      padding: 40px;
      text-align: center;
    "
  >
    <h2>Verify Your Email</h2>

    <p>Thank you for registering.</p>

    <p>Click the button below to verify your email.</p>

    <a
      href="${verificationLink}"
      style="
        display: inline-block;
        padding: 15px 30px;
        background: #2563eb;
        color: white;
        text-decoration: none;
        border-radius: 6px;
      "
    >
      Verify Email
    </a>

    <br /><br />

    <p>If the button doesn't work, copy this link:</p>

    <p>${verificationLink}</p>

    <br />

    <p>Or enter this code on the verification page:</p>

    <div
      style="
        display: inline-block;
        font-size: 32px;
        font-weight: bold;
        letter-spacing: 8px;
        padding: 12px 24px;
        background: #eef2ff;
        color: #2563eb;
        border-radius: 6px;
      "
    >
      ${otp}
    </div>

    <p style="color: #666; font-size: 13px;">
      This link and code will expire in 1 hour.
    </p>
  </body>
</html>`;

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    // Send mail
    await transporter.sendMail({
      from: `"Internship" <${process.env.EMAIL}>`,
      to: email,
      subject: "Verify Your Email",
      html,
    });

    console.log("✅ Email sent successfully");
    console.log(verificationLink);
    console.log(html);
  } catch (err) {
    console.log(err);
  }
};

export default SendVerficationEmail;
