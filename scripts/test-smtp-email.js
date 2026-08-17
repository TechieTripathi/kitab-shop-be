import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const DEFAULT_TEST_RECIPIENT = "vishnutripathi.a@gmail.com";

const maskEmail = (email = "") => {
  const normalized = String(email).trim();
  return normalized
    ? normalized.replace(/^(.{2}).*(@.*)$/, "$1***$2")
    : "";
};


let EMAIL="info.kitabshop@gmail.com"
let EMAIL_PASSWORD="sbys rpli asfj nctw"


const recipient = String(process.argv[2] || DEFAULT_TEST_RECIPIENT).trim();
const sender = String(EMAIL || "").trim();
const password = String(EMAIL_PASSWORD || "");
const sentAt = new Date().toISOString();
const subject = `Kitab Shop SMTP diagnostic test - ${sentAt}`;


if (!sender || !password) {
  console.error("SMTP_SEND_FAILED");
  console.error("EMAIL and EMAIL_PASSWORD must be set in kitab-shop-be/.env");
  process.exit(1);
}

if (!recipient) {
  console.error("SMTP_SEND_FAILED");
  console.error("Recipient email is required.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: sender,
    pass: password,
  },
});

try {
  console.log(
    JSON.stringify(
      {
        action: "smtp_test_email",
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        from: maskEmail(sender),
        to: maskEmail(recipient),
        subject,
      },
      null,
      2,
    ),
  );

  await transporter.verify();

  const info = await transporter.sendMail({
    from: `"Kitab Shop SMTP Test" <${sender}>`,
    to: recipient,
    subject,
    text: [
      "This is a diagnostic email from the Kitab Shop backend SMTP configuration.",
      "",
      `Sent at: ${sentAt}`,
      `Sender: ${sender}`,
      `Recipient: ${recipient}`,
    ].join("\n"),
  });

  console.log(
    JSON.stringify(
      {
        status: "SMTP_SEND_OK",
        messageId: info.messageId,
        accepted: (info.accepted || []).map(maskEmail),
        rejected: (info.rejected || []).map(maskEmail),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("SMTP_SEND_FAILED");
  console.error(
    JSON.stringify(
      {
        code: error.code,
        responseCode: error.responseCode,
        command: error.command,
        response: error.response,
        message: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
