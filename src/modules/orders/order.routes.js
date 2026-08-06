import express from "express";
import {
  CancelOrder,
  GetAllOrders,
  GetMyOrders,
  GetSingleOrder,
  AddOrderNote,
  CreateSplitShipment,
  PartialCancelOrder,
  PlaceOrder,
  UpdateOrderStatus,
} from "./order.controller.js";
import {
  AssignAwb,
  CheckServiceability,
  CreateShipment,
  GenerateInvoice,
  GenerateLabel,
  GetInvoice,
  SchedulePickup,
  ShippingWebhook,
  TrackShipment,
} from "../shipping/shipping.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  addOrderNoteSchema,
  orderIdParamSchema,
  partialCancelSchema,
  placeOrderSchema,
  splitShipmentSchema,
  updateOrderStatusSchema,
} from "./order.schema.js";
import UserModel from "../../model/User.model.js";
import {
  getPrimaryRole,
  hasAdminRole,
  normalizeRoles,
} from "../../config/admin-permissions.config.js";

const routes = express.Router();

const canManageOrders = async (req, res, next) => {
  if (!hasAdminRole(req.user)) {
    return res.status(403).json({
      success: false,
      message: "You are not allowed to manage orders",
    });
  }

  const user = await UserModel.findById(req.user.id).select("roles isActive");

  if (!user || user.isActive === false || !hasAdminRole(user)) {
    return res.status(403).json({
      success: false,
      message: "You are not allowed to manage orders",
    });
  }

  req.user.role = getPrimaryRole(user);
  req.user.roles = normalizeRoles(user);

  next();
};

routes.post("/create", TokenVerify, validate(placeOrderSchema), PlaceOrder);
routes.post("/place-order", TokenVerify, validate(placeOrderSchema), PlaceOrder);
routes.post("/shipping/webhook", ShippingWebhook);
routes.get("/shipping/serviceability", TokenVerify, CheckServiceability);
routes.get("/my-orders", TokenVerify, GetMyOrders);
routes.get("/all", TokenVerify, canManageOrders, GetAllOrders);
routes.post("/:orderId/shipment", TokenVerify, canManageOrders, CreateShipment);
routes.post("/:orderId/shipment/awb", TokenVerify, canManageOrders, AssignAwb);
routes.post("/:orderId/shipment/pickup", TokenVerify, canManageOrders, SchedulePickup);
routes.post("/:orderId/shipment/label", TokenVerify, canManageOrders, GenerateLabel);
routes.post("/:orderId/shipment/invoice", TokenVerify, canManageOrders, GenerateInvoice);
routes.get("/:orderId/shipment/invoice", TokenVerify, GetInvoice);
routes.get("/:orderId/shipment/tracking", TokenVerify, TrackShipment);
routes.get("/:orderId", TokenVerify, validate(orderIdParamSchema), GetSingleOrder);
routes.patch("/:orderId/status", TokenVerify, canManageOrders, validate(updateOrderStatusSchema), UpdateOrderStatus);
routes.post("/:orderId/notes", TokenVerify, canManageOrders, validate(addOrderNoteSchema), AddOrderNote);
routes.post("/:orderId/split-shipments", TokenVerify, canManageOrders, validate(splitShipmentSchema), CreateSplitShipment);
routes.patch("/:orderId/partial-cancel", TokenVerify, canManageOrders, validate(partialCancelSchema), PartialCancelOrder);
routes.patch("/:orderId/cancel", TokenVerify, validate(orderIdParamSchema), CancelOrder);

export default routes;
