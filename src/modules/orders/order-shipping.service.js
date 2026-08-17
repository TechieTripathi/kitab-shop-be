import OrderModel from "./Order.model.js";
import { getFeatures } from "../../config/features.config.js";
import {
  cancelShiprocketOrder,
  checkCodServiceability,
  getShippingCapabilities,
  createShiprocketOrder,
} from "../shipping/shiprocket.service.js";
import { logLifecycleEvent, logLifecycleError } from "../../utils/lifecycle-logger.service.js";
import { INDIAN_PINCODE_REGEX } from "../../config/india-geo.config.js";

/**
 * A shipment that our records say should be cancelled but Shiprocket has not
 * confirmed yet.
 *
 * Deliberately DERIVED rather than stored as a new state. The two facts that
 * matter already exist: the order is cancelled locally, and a shipment exists
 * whose syncStatus is not yet "cancelled". A `cancel_pending` enum value would be
 * a third copy of that truth, free to drift out of step with both.
 *
 * Unambiguous because nothing else drives an order with a shipment to Cancelled:
 * `UpdateOrderStatus` refuses "Cancelled" outright (USE_CANCEL_ENDPOINT), and the
 * abandoned-checkout sweeper only touches unpaid prepaid orders, which never have
 * a shipment.
 */
export const SHIPMENT_CANCELLATION_PENDING = {
  orderStatus: "Cancelled",
  "shiprocket.orderId": { $ne: null },
  "shiprocket.syncStatus": { $ne: "cancelled" },
};

/**
 * Shiprocket's way of saying "this was already cancelled".
 *
 * Treated as success, and that is the whole reconciliation story for this
 * operation: if an earlier attempt's response was lost, the retry finds the
 * shipment already cancelled and adopts it. There is no way to *query* order state
 * in this integration (only `trackAwb`, which needs an AWB that a pre-dispatch
 * cancellation does not have), so retrying and reading the answer is the only
 * mechanism available — and it is sufficient here, because cancelling twice is
 * harmless.
 */
const isAlreadyCancelled = (error) =>
  /already\s+(been\s+)?cancell?ed|order\s+is\s+cancell?ed/i.test(String(error?.message || ""));

/**
 * Cancels the courier shipment for an order that has ALREADY been cancelled locally.
 *
 * Runs strictly after the local cancellation is committed. The previous ordering
 * called Shiprocket *before* the local claim, so two concurrent cancellations both
 * cancelled the shipment while only one could win the claim — and if the winner's
 * transaction then failed, the order stayed active with its parcel already
 * cancelled at the courier. The local order state is authoritative; the courier is
 * told afterwards.
 *
 * Unlike a refund, this operation is IDEMPOTENT IN EFFECT: it names one Shiprocket
 * order, the end state is terminal, and repeating it moves no money and cannot
 * touch a different order. So a plain retry is safe and no attempt-claim or
 * verify-before-retry is needed — the machinery the refund paths need would be
 * cargo-culting here.
 *
 * Never throws. The local cancellation, the restock, the wallet credit, the coupon
 * release and the refund liability are all already committed, and a courier API
 * problem must not undo or obscure any of them. A failure leaves the derived
 * pending state above, plus the reason in `shiprocket.lastError`.
 *
 * @returns {{attempted: boolean, cancelled: boolean, reason?: string, adopted?: boolean, error?: string}}
 */
export const cancelShipmentForCancelledOrder = async (order) => {
  const shiprocketOrderId = order?.shiprocket?.orderId;
  if (!shiprocketOrderId) return { attempted: false, cancelled: false, reason: "no_shipment" };
  if (order.shiprocket?.syncStatus === "cancelled") {
    return { attempted: false, cancelled: true, reason: "already_cancelled" };
  }
  // Uses `shipments` rather than the raw env flag: if the admin has moved the store to
  // manual fulfilment, we must not call Shiprocket to cancel either — and the shipment
  // genuinely still exists at the courier, so it stays in the derived pending state.
  const capabilities = await getShippingCapabilities();
  if (!capabilities.shipments || !capabilities.configured) {
    // Left in the derived pending state on purpose rather than silently marked
    // cancelled: the shipment really does still exist at the courier.
    logLifecycleEvent("shipping", "shiprocket_cancel_skipped", {
      orderId: order?._id,
      shiprocketOrderId,
      reason: "shipping_disabled_or_unconfigured",
    });
    return { attempted: false, cancelled: false, reason: "shipping_disabled" };
  }

  const markCancelled = async () => {
    await OrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          "shiprocket.syncStatus": "cancelled",
          "shiprocket.status": "CANCELLED",
          "shiprocket.lastError": null,
          "shiprocket.lastSyncedAt": new Date(),
        },
      },
    );
  };

  try {
    await cancelShiprocketOrder(shiprocketOrderId);
    await markCancelled();
    logLifecycleEvent("shipping", "shiprocket_cancel_succeeded", {
      orderId: order?._id,
      shiprocketOrderId,
    });
    return { attempted: true, cancelled: true };
  } catch (error) {
    if (isAlreadyCancelled(error)) {
      await markCancelled();
      logLifecycleEvent("shipping", "shiprocket_cancel_already_done", {
        orderId: order?._id,
        shiprocketOrderId,
      });
      return { attempted: true, cancelled: true, adopted: true };
    }

    // syncStatus is deliberately NOT set to "failed": that value means the
    // shipment SYNC failed, and overwriting the real fulfilment state
    // ("awb_assigned", say) would destroy the record of what actually exists at
    // the courier. The reason goes in lastError; the pending state stays derivable.
    await OrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          "shiprocket.lastError": `Cancellation failed: ${error.message}`,
          "shiprocket.lastSyncedAt": new Date(),
        },
      },
    ).catch(() => {});
    logLifecycleError("shipping", "shiprocket_cancel_failed", error, {
      orderId: order?._id,
      shiprocketOrderId,
    });
    return { attempted: true, cancelled: false, error: error.message };
  }
};

/**
 * Decides whether a COD order may be placed to this pincode.
 *
 * The admin panel has always offered "restrict COD by Shiprocket pincode
 * serviceability", and the setting was stored and read — but nothing in the order path
 * consulted it, so the restriction never applied. A customer could select COD for any
 * destination and the order was created. This function is that missing decision.
 *
 * FAILS CLOSED, and that is the whole point. A business restriction that cannot be
 * evaluated must refuse, not wave the order through: an expired token, a Shiprocket
 * outage or missing credentials would otherwise disable the restriction precisely when
 * nobody is watching. So "we could not ask" is treated the same as "no" — the customer
 * is told COD is unavailable for this address and pointed at online payment.
 *
 * Kept as a single pure-ish decision (one awaited carrier call, no writes) so it can be
 * exercised directly, and so every COD gate stays readable in one place in PlaceOrder.
 *
 * @returns {Promise<{allowed: boolean, reason: string, code?: string, message?: string, courierCount?: number}>}
 */
export const evaluateCodPincodeRestriction = async ({
  paymentMethod,
  restrictionEnabled,
  pincode,
} = {}) => {
  // Prepaid orders are untouched — the restriction is about collecting cash at the door.
  if (String(paymentMethod ?? "").toUpperCase() !== "COD") {
    return { allowed: true, reason: "not_cod" };
  }
  if (!restrictionEnabled) {
    return { allowed: true, reason: "restriction_disabled" };
  }

  // Re-validated with the project's existing rule rather than a new one. prepareOrderData
  // already enforces this, so reaching it here means the pincode was stripped or
  // tampered with on a path that skipped that validation.
  const normalized = String(pincode ?? "").trim();
  if (!INDIAN_PINCODE_REGEX.test(normalized)) {
    logLifecycleEvent("shipping", "cod_pincode_restriction_blocked", {
      reason: "invalid_pincode",
      pincode: normalized || null,
    });
    return {
      allowed: false,
      reason: "invalid_pincode",
      code: "COD_PINCODE_INVALID",
      message:
        "Enter a valid 6-digit delivery PIN code to pay by Cash on Delivery, or choose another payment method.",
    };
  }

  const result = await checkCodServiceability({ deliveryPostcode: normalized });

  if (result.serviceable) {
    return { allowed: true, reason: "serviceable", courierCount: result.courierCount };
  }

  // The distinction matters for OPERATORS — an outage needs investigating, an
  // unserviceable pincode does not — so the two are logged differently. The customer
  // sees the same message either way, and never the carrier's error text.
  if (result.unverified) {
    logLifecycleError(
      "shipping",
      "cod_serviceability_unverified",
      new Error(`COD serviceability could not be verified: ${result.reason}`),
      { pincode: normalized, reason: result.reason },
    );
  } else {
    logLifecycleEvent("shipping", "cod_pincode_not_serviceable", { pincode: normalized });
  }

  return {
    allowed: false,
    reason: result.unverified ? `unverified:${result.reason}` : "not_serviceable",
    code: result.unverified ? "COD_SERVICEABILITY_UNVERIFIED" : "COD_PINCODE_NOT_SERVICEABLE",
    message:
      "Cash on Delivery is not available for this delivery address. Please choose another payment method.",
  };
};

export const syncOrderToShiprocketIfEnabled = async (order) => {
  // One capability call instead of three separate reads: `autoPush` already folds in
  // the env ceiling, the admin's "use Shiprocket for shipments" choice and the
  // auto-push choice, so those cannot drift apart at different call sites.
  const capabilities = await getShippingCapabilities();
  if (!capabilities.autoPush || !capabilities.configured) return;

  try {
    logLifecycleEvent("shipping", "shiprocket_sync_started", { orderId: order?._id });
    if (!order.user?.email) {
      await order.populate("user", "email");
    }
    // Needed so computeOrderPackage() (inside createShiprocketOrder) can read
    // each item's real weight/dimensions instead of just an unpopulated id.
    await order.populate("items.product", "weight length breadth height");
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
