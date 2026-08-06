import crypto from "node:crypto";
import { isShippingEnabled, isShippingWebhookEnabled } from "../../config/features.config.js";
import OrderModel from "../orders/Order.model.js";
import { notifyShipmentUpdated } from "../notifications/notification.service.js";
import {
  ShiprocketError,
  assignAwb,
  checkServiceability,
  createShiprocketOrder,
  generateInvoice,
  generateLabel,
  resolvePackage,
  schedulePickup,
  trackAwb,
} from "./shiprocket.service.js";
import { hasAdminRole } from "../../config/admin-permissions.config.js";

const errorResponse = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    ...(process.env.NODE_ENV !== "production" && error.details
      ? { details: error.details }
      : {}),
  });

const findOrder = (orderId) =>
  OrderModel.findById(orderId).populate("user", "email").populate("items.product", "_id");

const readAwbData = (response) => response?.response?.data || response?.data || response || {};

const ensureShiprocketEnabled = () => {
  if (!isShippingEnabled()) {
    throw new ShiprocketError("Shiprocket is disabled for this environment", 503);
  }
};

export const CreateShipment = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await findOrder(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (order.orderStatus === "Cancelled") {
      return res.status(409).json({ success: false, message: "Cancelled orders cannot be shipped" });
    }
    if (order.shiprocket?.orderId) {
      return res.status(200).json({
        success: true,
        message: "Order is already synced with Shiprocket",
        order,
      });
    }

    const {
      data,
      packageDetails,
      shiprocketOrderId,
      shipmentId,
    } = await createShiprocketOrder(order, req.body?.package);
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

    return res.status(201).json({
      success: true,
      message: "Order created in Shiprocket",
      order,
    });
  } catch (error) {
    if (req.params.orderId) {
      await OrderModel.findByIdAndUpdate(req.params.orderId, {
        "shiprocket.syncStatus": "failed",
        "shiprocket.lastError": error.message,
        "shiprocket.lastSyncedAt": new Date(),
      }).catch(() => {});
    }
    return errorResponse(res, error);
  }
};

export const CheckServiceability = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const deliveryPostcode = String(req.query.deliveryPostcode || "").trim();
    if (!/^\d{6}$/.test(deliveryPostcode)) {
      return res.status(400).json({ success: false, message: "A valid deliveryPostcode is required" });
    }

    const packageDetails = resolvePackage(req.query);
    const data = await checkServiceability({
      ...packageDetails,
      deliveryPostcode,
      pickupPostcode: req.query.pickupPostcode,
      cod: ["1", "true", "cod"].includes(String(req.query.cod).toLowerCase()),
      declaredValue: req.query.declaredValue,
      mode: req.query.mode,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const AssignAwb = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.shiprocket?.shipmentId) {
      return res.status(409).json({ success: false, message: "Create the Shiprocket order first" });
    }

    const response = await assignAwb(order.shiprocket.shipmentId, req.body?.courierId);
    const data = readAwbData(response);
    order.shiprocket.awbCode = data.awb_code || order.shiprocket.awbCode;
    order.shiprocket.courierId =
      Number(data.courier_company_id || data.courier_id) || order.shiprocket.courierId;
    order.shiprocket.courierName = data.courier_name || order.shiprocket.courierName;
    order.shiprocket.syncStatus = "awb_assigned";
    order.shiprocket.lastError = null;
    order.shiprocket.lastSyncedAt = new Date();
    await order.save();

    return res.status(200).json({ success: true, message: "AWB assigned", order, data: response });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const SchedulePickup = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.shiprocket?.shipmentId || !order.shiprocket?.awbCode) {
      return res.status(409).json({ success: false, message: "Assign an AWB before scheduling pickup" });
    }

    const pickupDate = req.body?.pickupDate;
    if (pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
      return res.status(400).json({ success: false, message: "pickupDate must use YYYY-MM-DD" });
    }
    const data = await schedulePickup(order.shiprocket.shipmentId, pickupDate);
    order.shiprocket.syncStatus = "pickup_scheduled";
    order.shiprocket.lastError = null;
    order.shiprocket.lastSyncedAt = new Date();
    await order.save();

    return res.status(200).json({ success: true, message: "Pickup scheduled", order, data });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const GenerateLabel = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.shiprocket?.shipmentId || !order.shiprocket?.awbCode) {
      return res.status(409).json({ success: false, message: "Assign an AWB before generating a label" });
    }

    const data = await generateLabel(order.shiprocket.shipmentId);
    order.shiprocket.labelUrl = data.label_url || order.shiprocket.labelUrl;
    order.shiprocket.lastSyncedAt = new Date();
    await order.save();
    return res.status(200).json({ success: true, labelUrl: order.shiprocket.labelUrl, data });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const GenerateInvoice = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (!order.shiprocket?.orderId) {
      return res.status(409).json({
        success: false,
        message: "Create the Shiprocket order before generating its invoice",
      });
    }

    const data = await generateInvoice(order.shiprocket.orderId);
    if (!data.invoice_url) {
      throw new ShiprocketError(
        data?.not_created?.length
          ? `Shiprocket did not create the invoice: ${JSON.stringify(data.not_created)}`
          : "Shiprocket did not return an invoice URL",
        502,
        data,
      );
    }

    order.shiprocket.invoiceUrl = data.invoice_url;
    order.shiprocket.lastError = null;
    order.shiprocket.lastSyncedAt = new Date();
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Invoice generated",
      invoiceUrl: order.shiprocket.invoiceUrl,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const GetInvoice = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const isOwner = String(order.user) === req.user.id;
    const isAdmin = hasAdminRole(req.user);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    if (!order.shiprocket?.invoiceUrl) {
      return res.status(404).json({
        success: false,
        message: "Invoice has not been generated yet",
      });
    }

    return res.status(200).json({
      success: true,
      invoiceUrl: order.shiprocket.invoiceUrl,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};

export const TrackShipment = async (req, res) => {
  try {
    ensureShiprocketEnabled();

    const order = await OrderModel.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const isOwner = String(order.user) === req.user.id;
    const isAdmin = hasAdminRole(req.user);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    if (!order.shiprocket?.awbCode) {
      return res.status(409).json({ success: false, message: "Tracking is not available yet" });
    }

    const data = await trackAwb(order.shiprocket.awbCode);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return errorResponse(res, error);
  }
};

const safeTokenMatch = (received, expected) => {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};

const mapOrderStatus = (statusCode, currentStatus) => {
  if (/rto|return to origin/i.test(currentStatus || "")) return "RTO";
  if (/ndr|non[- ]delivery/i.test(currentStatus || "")) return "NDR";
  if (statusCode === 7) return "Delivered";
  if (statusCode === 17) return "Out For Delivery";
  if ([6, 18, 19, 27, 38, 42].includes(statusCode)) return "Shipped";
  if (/packed|ready to ship/i.test(currentStatus || "")) return "Packed";
  return null;
};

export const ShippingWebhook = async (req, res) => {
  if (!isShippingWebhookEnabled()) {
    return res.status(200).json({ success: true, message: "Shiprocket webhook disabled" });
  }

  const expectedToken = String(process.env.SHIPROCKET_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken || !safeTokenMatch(req.get("x-api-key"), expectedToken)) {
    return res.status(401).json({ success: false, message: "Invalid webhook token" });
  }

  try {
    const sourceOrderId = String(req.body?.order_id || "").trim();
    const shiprocketOrderId = Number(req.body?.sr_order_id) || null;
    const awbCode = String(req.body?.awb || "").trim();
    const statusCode = Number(req.body?.shipment_status_id || req.body?.current_status_id) || null;
    const currentStatus = req.body?.shipment_status || req.body?.current_status || null;

    const query = sourceOrderId
      ? { _id: sourceOrderId }
      : shiprocketOrderId
        ? { "shiprocket.orderId": shiprocketOrderId }
        : awbCode
          ? { "shiprocket.awbCode": awbCode }
          : null;
    if (!query) return res.status(200).json({ success: true });

    const update = {
      "shiprocket.orderId": shiprocketOrderId,
      "shiprocket.awbCode": awbCode || null,
      "shiprocket.courierName": req.body?.courier_name || null,
      "shiprocket.status": currentStatus,
      "shiprocket.statusCode": statusCode,
      "shiprocket.ndrReason": req.body?.ndr_reason || req.body?.reason || "",
      "shiprocket.rtoReason": req.body?.rto_reason || "",
      "shiprocket.lastError": null,
      "shiprocket.lastSyncedAt": new Date(),
    };
    const mappedStatus = mapOrderStatus(statusCode, currentStatus);
    if (mappedStatus) update.orderStatus = mappedStatus;
    if (mappedStatus === "NDR") update["shiprocket.syncStatus"] = "ndr";
    if (mappedStatus === "RTO") update["shiprocket.syncStatus"] = "rto";

    const order = await OrderModel.findOneAndUpdate(query, { $set: update }, { new: true });
    if (order && mappedStatus) {
      await notifyShipmentUpdated({ orderId: order._id, status: mappedStatus });
    }
    return res.status(200).json({ success: true });
  } catch {
    // Shiprocket expects a 200 response; failed events can be reconciled through live tracking.
    return res.status(200).json({ success: true });
  }
};
