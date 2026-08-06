import OrderModel from "./Order.model.js";
import { getFeatures, isShippingEnabled } from "../../config/features.config.js";
import {
  createShiprocketOrder,
  isShiprocketConfigured,
} from "../shipping/shiprocket.service.js";
import { logLifecycleEvent, logLifecycleError } from "../../utils/lifecycle-logger.service.js";

export const syncOrderToShiprocketIfEnabled = async (order) => {
  const { shipping } = getFeatures();
  if (!isShippingEnabled() || !shipping.autoCreateOrder || !isShiprocketConfigured()) return;

  try {
    logLifecycleEvent("shipping", "shiprocket_sync_started", { orderId: order?._id });
    if (!order.user?.email) {
      await order.populate("user", "email");
    }
    const {
      data,
      packageDetails,
      shiprocketOrderId,
      shipmentId,
    } = await createShiprocketOrder(order);
    order.shiprocket = {
      ...order.shiprocket?.toObject?.(),
      orderId: shiprocketOrderId,
      shipmentId,
      status: data.status || "NEW",
      statusCode: Number(data.status_code) || null,
      awbCode: data.awb_code || null,
      courierId: Number(data.courier_company_id) || null,
      courierName: data.courier_name || null,
      syncStatus: data.awb_code ? "awb_assigned" : "created",
      package: packageDetails,
      lastError: null,
      lastSyncedAt: new Date(),
    };
    await order.save();
    logLifecycleEvent("shipping", "shiprocket_sync_finished", {
      orderId: order?._id,
      shiprocketOrderId,
      shipmentId,
      status: order.shiprocket.status,
    });
  } catch (error) {
    await OrderModel.findByIdAndUpdate(order._id, {
      "shiprocket.syncStatus": "failed",
      "shiprocket.lastError": error.message,
      "shiprocket.lastSyncedAt": new Date(),
    }).catch(() => {});
    logLifecycleError("shipping", "shiprocket_sync_failed", error, { orderId: order?._id });
  }
};
