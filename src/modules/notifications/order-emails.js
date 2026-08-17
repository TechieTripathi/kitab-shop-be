import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/**
 * Customer-facing lifecycle emails for the three order end-states an admin can
 * trigger: cancelled, completed (delivered + signed off) and closed (an RTO
 * case settled). The notification-service queue reaches no real channel (all
 * provider adapters are stubs), so email — the one transport this codebase
 * actually sends (verification, password reset, COD OTP) — is what makes
 * "notify the customer" true.
 *
 * Every sender is fire-and-forget at the call site: a mail failure must never
 * fail the order action it narrates.
 */

const buildTransporter = () =>
  nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

const wrap = (title, bodyHtml) => `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="margin:0;padding:0;background:#f9f9f9;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#333;border:1px solid #eee;border-radius:8px;">
      <h1 style="font-size:20px;text-align:center;margin-bottom:20px;">${title}</h1>
      ${bodyHtml}
      <p style="font-size:12px;color:#999;text-align:center;margin-top:28px;">
        Kitab Shop — this is an automated update about your order.
      </p>
    </div>
  </body>
</html>`;

const sendOrderEmail = async ({ email, subject, title, bodyHtml, text }) => {
  if (!email) return;
  const transporter = buildTransporter();
  await transporter.sendMail({
    from: `"Kitab Shop" <${process.env.EMAIL}>`,
    replyTo: process.env.EMAIL,
    to: email,
    subject,
    text,
    html: wrap(title, bodyHtml),
  });
};

const orderRef = (order) => `#${String(order._id)}`;

export const sendOrderCancelledEmail = async ({ order, email, reason, source, autoRefund }) => {
  const by = source === "admin" ? "by the store" : "at your request";
  const refundLine =
    Number(order.totalAmount) > 0 &&
    ["Paid", "Refund Pending", "Partially Refunded"].includes(order.paymentStatus)
      ? autoRefund
        ? "Your payment is being refunded to your original payment method — it typically arrives within 5–7 business days."
        : "Any amount you paid will be refunded — our team will contact you if payout details are needed."
      : "No payment had been collected for this order, so there is nothing to refund.";

  await sendOrderEmail({
    email,
    subject: `Your order ${orderRef(order)} has been cancelled`,
    title: "Order cancelled",
    text: `Your order ${orderRef(order)} was cancelled ${by}.${reason ? ` Reason: ${reason}.` : ""} ${refundLine}`,
    bodyHtml: `
      <p style="font-size:15px;color:#555;">Your order <strong>${orderRef(order)}</strong> was cancelled ${by}.</p>
      ${reason ? `<p style="font-size:15px;color:#555;"><strong>Reason:</strong> ${reason}</p>` : ""}
      <p style="font-size:15px;color:#555;">${refundLine}</p>`,
  });
};

export const sendOrderCompletedEmail = async ({ order, email }) => {
  await sendOrderEmail({
    email,
    subject: `Your order ${orderRef(order)} is complete`,
    title: "Order completed",
    text: `Your order ${orderRef(order)} has been completed successfully. Thank you for shopping with us!`,
    bodyHtml: `
      <p style="font-size:15px;color:#555;">Your order <strong>${orderRef(order)}</strong> has been completed successfully.</p>
      <p style="font-size:15px;color:#555;">Thank you for shopping with us — we hope to see you again soon!</p>`,
  });
};

export const sendOrderClosedEmail = async ({ order, email }) => {
  await sendOrderEmail({
    email,
    subject: `Your returned order ${orderRef(order)} is settled`,
    title: "Returned order settled",
    // Deliberately NOT "completed": Closed means the parcel came back to us
    // and the case (including any refund owed) has been settled.
    text: `Your order ${orderRef(order)} that was returned to us has been settled. Any refund owed is handled separately and you will see it reflected on the order.`,
    bodyHtml: `
      <p style="font-size:15px;color:#555;">Your order <strong>${orderRef(order)}</strong> that was returned to us has now been settled.</p>
      <p style="font-size:15px;color:#555;">If a refund is owed for this order, it is handled separately — you can check its status on the order page.</p>`,
  });
};
