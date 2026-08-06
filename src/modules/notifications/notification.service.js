import { getFeatures } from "../../config/features.config.js";
import NotificationEvent from "../../model/NotificationEvent.model.js";
import { sendNotificationChannel } from "./provider-adapters.js";
import { logLifecycleEvent, logLifecycleError } from "../../utils/lifecycle-logger.service.js";

const enabledChannels = () => {
  const { notifications } = getFeatures();
  if (!notifications.enabled) return [];

  return [
    notifications.sms ? "sms" : null,
    notifications.whatsapp ? "whatsapp" : null,
    notifications.phone ? "phone" : null,
  ].filter(Boolean);
};

const queueNotification = async (event, payload) => {
  const channels = enabledChannels();
  if (channels.length === 0) {
    await NotificationEvent.create({
      event,
      channels: [],
      status: "skipped",
      order: payload?.order?._id || payload?.orderId || null,
      user: payload?.order?.user?._id || payload?.order?.user || payload?.userId || null,
      phone: payload?.order?.shippingAddress?.phone || payload?.phone || "",
      email: payload?.order?.user?.email || payload?.email || "",
      message: "Notifications disabled by configuration",
    }).catch(() => {});
    return { queued: false, channels: [] };
  }

  const providerResults = await Promise.allSettled(
    channels.map((channel) =>
      sendNotificationChannel({ channel, event, payload }),
    ),
  );
  const failed = providerResults.filter((result) => result.status === "rejected");
  const firstResult = providerResults.find((result) => result.status === "fulfilled")?.value;

  await NotificationEvent.create({
    event,
    channels,
    orderId: payload?.order?._id || payload?.orderId || null,
    order: payload?.order?._id || payload?.orderId || null,
    user: payload?.order?.user?._id || payload?.order?.user || payload?.userId || null,
    phone: payload?.order?.shippingAddress?.phone || payload?.phone || "",
    email: payload?.order?.user?.email || payload?.email || "",
    status: failed.length > 0 ? "failed" : "queued",
    message: payload?.message || "",
    provider: firstResult?.provider || "noop",
    providerResponse: providerResults.map((result) =>
      result.status === "fulfilled" ? result.value : { error: result.reason?.message || String(result.reason) },
    ),
    error: failed.map((result) => result.reason?.message || String(result.reason)).join("; "),
  }).catch((error) => {
    logLifecycleError("notification", "record_failed", error, { event });
  });

  logLifecycleEvent("notification", failed.length > 0 ? "queued_with_failures" : "queued", {
    event,
    channels,
  });

  return { queued: true, channels };
};

export const notifyOrderPlaced = (order) =>
  queueNotification("order.placed", { order });

export const notifyPaymentSuccess = (order) =>
  queueNotification("payment.success", { order });

export const notifyPaymentFailed = ({ orderId, reason }) =>
  queueNotification("payment.failed", { orderId, reason });

export const notifyShipmentUpdated = ({ orderId, status }) =>
  queueNotification("shipment.updated", { orderId, status });

export const notifyRefundProcessed = ({ orderId, paymentId }) =>
  queueNotification("refund.processed", { orderId, paymentId });

export const notifyReturnUpdated = ({ orderId, userId, status }) =>
  queueNotification("return.updated", {
    orderId,
    userId,
    message: `Return status updated to ${status}`,
  });

export const notifyAbandonedCart = ({ userId, email, phone }) =>
  queueNotification("cart.abandoned", {
    userId,
    email,
    phone,
    message: "Cart recovery reminder",
  });
