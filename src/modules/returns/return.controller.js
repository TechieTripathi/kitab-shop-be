import mongoose from "mongoose";
import OrderModel from "../orders/Order.model.js";
import ProductModel from "../products/Product.model.js";
import ReturnModel, {
  OPEN_RETURN_STATUSES,
  QUANTITY_CONSUMING_RETURN_STATUSES,
  RETURN_STATUSES,
} from "./return.model.js";
import UserModel from "../../model/User.model.js";
import { createAuditLog } from "../audit/audit-log.js";
import { notifyRefundProcessed, notifyReturnUpdated } from "../notifications/notification.service.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";
import {
  proportionalRefundAmount,
  proportionalWalletRefund,
  refundReturnRequest,
} from "../payments/return-refund.service.js";
import { adminHasPermission } from "../../config/admin-access.service.js";
import { logLifecycleEvent, logLifecycleError } from "../../utils/lifecycle-logger.service.js";
import {
  createReplacementShipment,
  createReturnPickup,
  getShippingCapabilities,
  resolveWarehouseAddress,
} from "../shipping/shiprocket.service.js";
import {
  deductReplacementStock,
  restockReturnedItems,
} from "../inventory/restock.service.js";
const STATUS_TRANSITIONS = {
  pending: ["approved", "rejected"],
  approved: ["pickup_scheduled", "rejected"],
  pickup_scheduled: ["received"],
  // Which of refunded/replaced a given request may reach is further narrowed by
  // its own resolutionType in AdminUpdateReturnStatus — a replacement-policy
  // return can never be marked "refunded" and vice versa.
  //
  // "rejected" is reachable here too: this is the QC step. Without it the admin
  // was forced to refund or replace whatever came back in the box, even if it
  // was damaged, used, or the wrong item entirely.
  // "replaced" is deliberately NOT reachable from here any more. It was the old
  // single-step close-out that declared a replacement finished before the parcel
  // was packed and never deducted the outbound unit. Replacements now go through
  // DispatchReplacement, so that shortcut cannot be taken again. The state itself
  // is retained below so historical documents stay valid.
  received: ["refunded", "replacement_dispatched", "rejected"],
  refunded: [],
  replaced: [],
  // Manual replacement fulfilment. Only delivery follows dispatch; there is
  // deliberately no failed/lost/backordered state, because nothing in the system
  // supports one today.
  replacement_dispatched: ["replacement_delivered"],
  replacement_delivered: [],
  rejected: [],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateReturn = (query) =>
  query
    .populate("user", "email roles")
    .populate("product", "name image brand")
    // razorpayPaymentId is what decides whether the refund can go back through
    // the gateway automatically or has to be settled manually (COD), so the
    // admin UI needs it to know which flow to present.
    .populate(
      "order",
      "orderStatus paymentMethod paymentStatus totalAmount createdAt deliveredAt razorpayPaymentId",
    );

const populateReturnLean = (query) => populateReturn(query).lean();

/**
 * Masks the stored bank account number before a return goes out over the wire.
 *
 * The owner supplied it, so they get the last four digits back as confirmation —
 * enough to recognise the account, not enough to leak if the response is logged,
 * cached, or read over someone's shoulder. Only an operator who actually has to
 * push the money (returns:manage) receives the full number, and the UPI id and
 * IFSC are left intact because neither is usable on its own.
 */
const redactRefundDestination = (returnRequest, { isOwner }) => {
  const destination = returnRequest?.refundDestination;
  if (!isOwner || !destination?.accountNumber) return returnRequest;

  const accountNumber = String(destination.accountNumber);
  return {
    ...returnRequest,
    refundDestination: {
      ...destination,
      accountNumber:
        accountNumber.length > 4
          ? `${"•".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`
          : accountNumber,
    },
  };
};

export const CreateReturnRequest = async (req, res) => {
  try {
    const { orderId, productId, quantity = 1, reason, details = "", proofImages = [] } =
      req.body || {};

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }
    if (!String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "Return reason is required" });
    }
    if (!Array.isArray(proofImages)) {
      return res.status(400).json({ success: false, message: "Proof images must be an array" });
    }

    // subtotal/totalAmount are needed to value the refund against what the
    // customer actually paid; walletDiscount splits that value into the cash
    // half and the prepaid half; paymentMethod decides whether we must collect a
    // payout destination from them.
    // shippingCharge is needed because it is the one component a return does NOT
    // give back — see proportionalRefundAmount (audit H2-03).
    const order = await OrderModel.findById(orderId).select(
      "user orderStatus items deliveredAt subtotal totalAmount shippingCharge walletDiscount paymentMethod paymentStatus",
    );
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    if (String(order.user) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "You cannot return this order" });
    }
    if (order.orderStatus !== "Delivered") {
      return res.status(400).json({
        success: false,
        message: "A return can be requested only after the order is delivered",
      });
    }

    const orderItem = order.items.find(
      (item) => String(item.product) === String(productId),
    );
    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: "Product was not found in this order",
      });
    }

    // Products created before returnPolicy existed may have it missing or
    // partially stored, so each piece falls back independently rather than
    // only substituting when the whole object is absent.
    const product = await ProductModel.findById(productId).select("returnPolicy");
    const policyKind = product?.returnPolicy?.kind || "return";
    const policyWindowDays = Number(product?.returnPolicy?.windowDays) || 7;

    if (policyKind === "none") {
      return res.status(400).json({
        success: false,
        message: "This product is not eligible for return or replacement",
      });
    }

    // Orders delivered before deliveredAt existed have no timestamp to count
    // from — skip the window check for those rather than blocking them.
    if (order.deliveredAt) {
      const daysSinceDelivery = (Date.now() - order.deliveredAt.getTime()) / MS_PER_DAY;
      if (daysSinceDelivery > policyWindowDays) {
        return res.status(400).json({
          success: false,
          message: `The ${policyKind} window for this product (${policyWindowDays} days from delivery) has passed`,
        });
      }
    }

    const resolutionType = policyKind === "replacement" ? "replacement" : "refund";

    // ── HOW MANY UNITS OF THIS LINE ARE STILL RETURNABLE ─────────────────────
    // Three things consume a line: cancellation, and any return that is not
    // rejected. Cancelled units were restocked and refunded at cancellation time,
    // and returned units were restocked and refunded (or replaced) at resolution
    // time — counting either again pays for the same unit twice.
    //
    // The already-returned half of this is new, and it is REQUIRED by the index
    // change below rather than an extra. While only one return could ever exist
    // per line, "ordered − cancelled" was a complete answer; now that a second
    // return is possible once the first resolves, a line of 5 could otherwise be
    // returned 5 units at a time, without limit. The refund ledger would cap the
    // MONEY at the order total, but restockReturnedItems restocks
    // `returnRequest.quantity` per return, so the stock would inflate with every
    // repeat.
    //
    // Rejected returns are excluded: those goods went back to the customer.
    const consumedByReturns = await ReturnModel.aggregate([
      {
        $match: {
          order: order._id,
          product: orderItem.product,
          user: new mongoose.Types.ObjectId(String(req.user.id)),
          status: { $in: QUANTITY_CONSUMING_RETURN_STATUSES },
        },
      },
      { $group: { _id: null, quantity: { $sum: "$quantity" } } },
    ]);
    const alreadyReturned = Number(consumedByReturns[0]?.quantity) || 0;

    const returnableQuantity = Math.max(
      0,
      (Number(orderItem.quantity) || 0) -
        (Number(orderItem.cancelledQuantity) || 0) -
        alreadyReturned,
    );
    if (returnableQuantity === 0) {
      return res.status(400).json({
        success: false,
        message: alreadyReturned
          ? "Every unit of this item has already been cancelled or returned"
          : "Every unit of this item was already cancelled and refunded",
        code: "NOTHING_LEFT_TO_RETURN",
      });
    }

    const returnQuantity = Number.parseInt(quantity, 10);
    if (
      !Number.isInteger(returnQuantity) ||
      returnQuantity < 1 ||
      returnQuantity > returnableQuantity
    ) {
      return res.status(400).json({
        success: false,
        message: `Return quantity must be between 1 and ${returnableQuantity}`,
        code: "RETURN_QUANTITY_UNAVAILABLE",
      });
    }

    // Refused at CREATION, not after pickup. This block previously landed only
    // when the admin tried to settle the refund — by which point a courier had
    // been booked and the customer's goods collected for a return that could
    // never be paid.
    if (resolutionType === "refund" && order.paymentStatus === "Refunded") {
      return res.status(400).json({
        success: false,
        message:
          "This order has already been fully refunded, so there is nothing left to refund on a return.",
        code: "ORDER_ALREADY_REFUNDED",
      });
    }

    // Only an OPEN return blocks a new one. This used to match ANY return
    // regardless of status, which permanently barred the line: `rejected` is
    // terminal with no reopen endpoint, so a mistaken QC rejection left the
    // customer with no route at all, and a resolved partial return exhausted the
    // remaining units.
    //
    // A friendly pre-check, not the guard — two simultaneous requests can both
    // pass it. The partial unique index is what actually decides, and the E11000
    // handler below turns the loser into the same 409.
    const openReturn = await ReturnModel.findOne({
      order: order._id,
      product: orderItem.product,
      user: req.user.id,
      status: { $in: OPEN_RETURN_STATUSES },
    }).select("returnNumber status");
    if (openReturn) {
      return res.status(409).json({
        success: false,
        message: `A return request for this product is already in progress (${openReturn.returnNumber}). Wait for it to be resolved before raising another.`,
        code: "OPEN_RETURN_EXISTS",
      });
    }

    // A COD order has no payment to reverse, so the customer has to tell us
    // where to send the money. Only required for refunds — a replacement needs
    // no payout — and validated here so the request can't be created in a state
    // the admin later can't act on.
    const needsDestination = resolutionType === "refund" && order.paymentMethod !== "RAZORPAY";
    let refundDestination;
    if (needsDestination) {
      const destination = req.body?.refundDestination || {};
      const method = String(destination.method || "").toLowerCase();

      if (method === "upi") {
        const upiId = String(destination.upiId || "").trim();
        if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) {
          return res.status(400).json({
            success: false,
            message: "Enter a valid UPI ID (for example name@bank) to receive your refund",
            code: "REFUND_DESTINATION_REQUIRED",
          });
        }
        refundDestination = { method: "upi", upiId };
      } else if (method === "bank_transfer") {
        const accountName = String(destination.accountName || "").trim();
        const accountNumber = String(destination.accountNumber || "").replace(/\s/g, "");
        const ifsc = String(destination.ifsc || "").trim().toUpperCase();

        if (!accountName || !/^\d{9,18}$/.test(accountNumber) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
          return res.status(400).json({
            success: false,
            message:
              "Enter the account holder name, a valid account number and a valid IFSC code to receive your refund",
            code: "REFUND_DESTINATION_REQUIRED",
          });
        }
        refundDestination = { method: "bank_transfer", accountName, accountNumber, ifsc };
      } else {
        return res.status(400).json({
          success: false,
          message:
            "This order was paid by Cash on Delivery, so tell us where to send your refund — choose UPI or bank transfer",
          code: "REFUND_DESTINATION_REQUIRED",
        });
      }
    }

    const returnRequest = await ReturnModel.create({
      order: order._id,
      user: req.user.id,
      product: orderItem.product,
      productSnapshot: {
        name: orderItem.name,
        image: orderItem.image,
        price: orderItem.price,
      },
      quantity: returnQuantity,
      reason: String(reason).trim(),
      details: String(details || "").trim(),
      proofImages: proofImages.slice(0, 5),
      // Valued against what was actually paid, not the pre-discount list price.
      refundAmount: proportionalRefundAmount({
        unitPrice: orderItem.price,
        quantity: returnQuantity,
        orderSubtotal: order.subtotal,
        orderTotal: order.totalAmount,
        // Excluded from the refund: the parcel was shipped and the courier paid.
        orderShippingCharge: order.shippingCharge,
      }),
      // The prepaid half. Split out at request time so the customer is quoted the
      // whole amount they are owed, not just the card portion.
      walletRefundAmount: proportionalWalletRefund({
        unitPrice: orderItem.price,
        quantity: returnQuantity,
        orderSubtotal: order.subtotal,
        walletDiscount: order.walletDiscount,
      }),
      resolutionType,
      ...(refundDestination ? { refundDestination } : {}),
    });

    await notifyReturnUpdated({
      orderId: order._id,
      userId: req.user.id,
      status: returnRequest.status,
    });

    return res.status(201).json({
      success: true,
      message: "Return request submitted successfully",
      data: returnRequest,
    });
  } catch (error) {
    // The partial unique index rejecting a concurrent duplicate. This is the
    // authoritative guard — the pre-check above is a read-then-act pair that two
    // simultaneous requests can both pass — so it answers with the same 409.
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A return request for this product is already in progress. Wait for it to be resolved before raising another.",
        code: "OPEN_RETURN_EXISTS",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetMyReturns = async (req, res) => {
  try {
    const returns = await populateReturn(
      ReturnModel.find({ user: req.user.id }).sort({ createdAt: -1 }),
    ).lean();

    return res.status(200).json({
      success: true,
      total: returns.length,
      data: returns,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetReturnById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    const returnRequest = await populateReturnLean(ReturnModel.findById(req.params.id));
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }

    const isOwner = String(returnRequest.user?._id || returnRequest.user) === String(req.user.id);
    // A non-owner needs returns:manage, not merely an admin-tier role. This
    // record carries refundDestination — UPI id, account number, IFSC — so the
    // old hasAdminRole() check let a themeEditor read customer bank details.
    const canManageReturns =
      !isOwner && (await adminHasPermission(req.user, ADMIN_PERMISSIONS.RETURNS_MANAGE));
    if (!isOwner && !canManageReturns) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    return res
      .status(200)
      .json({ success: true, data: redactRefundDestination(returnRequest, { isOwner }) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminGetReturns = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
    const status = String(req.query.status || "all");
    const search = String(req.query.search || "").trim();
    const order = String(req.query.order || "").trim();
    const filter = {};

    if (status !== "all" && RETURN_STATUSES.includes(status)) filter.status = status;

    // Explicit order filter (used by the admin order page's Returns card and
    // the ?order= deep link) — separate from `search`, which only matches an
    // order id incidentally.
    if (order) {
      if (!mongoose.Types.ObjectId.isValid(order)) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ORDER_ID",
          message: "order must be a valid order id",
        });
      }
      filter.order = order;
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const [users, products] = await Promise.all([
        UserModel.find({ email: regex }).distinct("_id"),
        ProductModel.find({ name: regex }).distinct("_id"),
      ]);
      filter.$or = [
        { returnNumber: regex },
        { reason: regex },
        { details: regex },
        { "productSnapshot.name": regex },
        { user: { $in: users } },
        { product: { $in: products } },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) {
        filter.$or.push({ _id: search }, { order: search });
      }
    }

    const [returns, total] = await Promise.all([
      populateReturn(
        ReturnModel.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
      ).lean(),
      ReturnModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: returns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AdminUpdateReturnStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    const status = String(req.body?.status || "");
    const adminNote = String(req.body?.adminNote || "").trim();
    const disposition = String(req.body?.disposition || "").trim().toLowerCase();
    const dispositionNote = String(req.body?.dispositionNote || "").trim();
    if (!RETURN_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid return status" });
    }

    // `let`, not `const`: the atomic claim below replaces this document with the
    // post-claim one. It was declared `const` while line ~582 assigned to it, so
    // EVERY call that got as far as the claim threw "Assignment to constant
    // variable" and the outer catch turned it into a 500 — no return could be
    // approved, received, refunded or rejected at all. Nothing caught it because no
    // test drove this endpoint; see replacement-fulfilment.regression.mjs.
    let returnRequest = await ReturnModel.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }

    const allowedNextStatuses = STATUS_TRANSITIONS[returnRequest.status] || [];
    if (!allowedNextStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Return cannot move from ${returnRequest.status} to ${status}`,
      });
    }

    // "received" can move to either refunded or replaced in the abstract,
    // but a given request is only ever eligible for the one matching its
    // own resolutionType (decided at request time from the product's policy).
    if (status === "refunded" && returnRequest.resolutionType !== "refund") {
      return res.status(400).json({
        success: false,
        message: "This return is a replacement, not a refund — use the replaced status instead",
      });
    }
    if (status === "replaced" && returnRequest.resolutionType !== "replacement") {
      return res.status(400).json({
        success: false,
        message: "This return is a refund, not a replacement — use the refunded status instead",
      });
    }

    // The replacement states carry side effects this endpoint does not perform —
    // recording the courier and AWB, and deducting the outbound unit from stock —
    // so they have their own endpoints. Same convention as UpdateOrderStatus
    // refusing "Cancelled" and pointing at the cancel endpoint.
    if (status === "replacement_dispatched" || status === "replacement_delivered") {
      return res.status(400).json({
        success: false,
        message:
          status === "replacement_dispatched"
            ? "Use the dispatch-replacement endpoint — it records the courier and AWB and takes the replacement unit out of stock."
            : "Use the confirm-replacement-delivery endpoint.",
        code: "USE_REPLACEMENT_ENDPOINT",
      });
    }

    // ── INVENTORY DISPOSITION ────────────────────────────────────────────────
    // Whether the customer gets their money and whether the goods can be resold
    // are INDEPENDENT decisions. Resolving a return therefore requires an explicit
    // disposition, and there is deliberately no default: silently assuming
    // "resellable" is what put refunded-but-faulty units back on sale, and
    // silently assuming "damaged" would quietly write off good stock.
    if ((status === "refunded" || status === "replaced") && !["resellable", "damaged"].includes(disposition)) {
      return res.status(400).json({
        success: false,
        message:
          "Record the condition of the returned goods: \"resellable\" puts them back into stock, \"damaged\" writes them off. The customer is refunded or replaced either way.",
        code: "DISPOSITION_REQUIRED",
      });
    }

    // Rejecting an item the customer has already shipped back is a QC failure,
    // and the customer is owed an explanation they can dispute. Requiring the
    // note here means "rejected after receipt" is never an unexplained decision.
    if (status === "rejected" && returnRequest.status === "received" && !adminNote) {
      return res.status(400).json({
        success: false,
        message:
          "Add a note explaining why the returned item failed inspection — the customer is shown this reason",
        code: "QC_REJECTION_REASON_REQUIRED",
      });
    }

    // Money moves BEFORE the status flips. Marking a return "refunded" used to
    // be a status change only, so the customer was told "refund processed" while
    // their money was still with the store until an admin separately remembered
    // to raise a Razorpay refund by hand. If this throws, the return stays at
    // "received" and nothing is claimed to the customer.
    // ─── ATOMIC CLAIM ───────────────────────────────────────────────────────
    // Everything above validated against a document read at the top of this
    // handler, so two concurrent PATCHes could both pass and both reach the
    // gateway — refunding the customer twice for one return. Claiming the
    // transition here, with the expected current status in the FILTER, means
    // exactly one request proceeds. This runs BEFORE any money moves.
    const previousStatus = returnRequest.status;
    const claimed = await ReturnModel.findOneAndUpdate(
      { _id: returnRequest._id, status: previousStatus },
      { $set: { status } },
      { returnDocument: "after" },
    );

    if (!claimed) {
      return res.status(409).json({
        success: false,
        message:
          "This return was updated by someone else a moment ago. Reload it and try again.",
        code: "RETURN_STATUS_CONFLICT",
      });
    }
    returnRequest = claimed;

    let refundResult;
    if (status === "refunded") {
      const order = await OrderModel.findById(returnRequest.order);
      if (!order) {
        // Put the status back — nothing was settled.
        await ReturnModel.updateOne({ _id: returnRequest._id }, { $set: { status: previousStatus } });
        return res.status(404).json({
          success: false,
          message: "The order for this return no longer exists",
        });
      }

      try {
        refundResult = await refundReturnRequest({
          order,
          returnRequest,
          adminId: req.user.id,
          manual: { method: req.body?.refundMethod, reference: req.body?.refundReference },
        });
      } catch (error) {
        // The claim moved the status to "refunded" before the money was
        // attempted, so it has to be released again — otherwise the return
        // would read as refunded with nothing settled, which is the precise
        // failure this module exists to prevent.
        await ReturnModel.updateOne({ _id: returnRequest._id }, { $set: { status: previousStatus } });
        return res.status(error.statusCode || 502).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
    }

    if (adminNote) returnRequest.adminNote = adminNote;
    if (status === "pickup_scheduled") {
      const pickupDate = req.body?.pickupScheduledAt
        ? new Date(req.body.pickupScheduledAt)
        : new Date();
      returnRequest.pickupScheduledAt = Number.isNaN(pickupDate.getTime())
        ? new Date()
        : pickupDate;
    }
    if (status === "received") returnRequest.receivedAt = new Date();
    if (status === "refunded") returnRequest.refundedAt = new Date();
    if (status === "replaced") returnRequest.replacedAt = new Date();
    if (disposition) {
      returnRequest.disposition = disposition;
      returnRequest.dispositionNote = dispositionNote;
    }

    // Restock follows the DISPOSITION, not the resolution. restockReturnedItems
    // itself refuses anything that is not explicitly "resellable", so a damaged
    // return is refunded to the customer and written off the shelf — which is the
    // whole point of separating the two decisions. "rejected" never restocks
    // either: the goods go back to the customer.
    let restockedQuantity = 0;
    if (status === "refunded" || status === "replaced") {
      restockedQuantity = await restockReturnedItems({ returnRequest });
    }

    returnRequest.statusHistory.push({
      status,
      changedBy: req.user.id,
      note: adminNote,
    });
    await returnRequest.save();
    await notifyReturnUpdated({
      orderId: returnRequest.order,
      userId: returnRequest.user,
      status,
    });
    if (status === "refunded") {
      await notifyRefundProcessed({
        orderId: returnRequest.order,
        paymentId: refundResult?.refund?.providerRefundId || null,
      });
    }

    await createAuditLog({
      admin: req.user.id,
      action: "UPDATE_RETURN_STATUS",
      module: "RETURN",
      targetId: returnRequest._id,
      targetName: returnRequest.returnNumber,
      description: `Updated ${returnRequest.returnNumber} from ${
        returnRequest.statusHistory.at(-2)?.status || "pending"
      } to ${status}`,
      req,
    });

    const populatedReturn = await populateReturnLean(ReturnModel.findById(returnRequest._id));
    // Both side effects are reported back, so the operator knows the wallet share
    // was already handled and does not pay it out a second time by hand.
    const notes = [
      restockedQuantity > 0 ? `${restockedQuantity} unit(s) returned to stock` : "",
      // Stated out loud: a write-off is a real inventory loss and should never be
      // something the operator has to infer from the absence of a message.
      returnRequest.disposition === "damaged"
        ? `${returnRequest.quantity} unit(s) written off as damaged — NOT returned to stock`
        : "",
      refundResult?.walletCredited > 0
        ? `₹${refundResult.walletCredited} of wallet credit returned`
        : "",
    ].filter(Boolean);
    return res.status(200).json({
      success: true,
      message: notes.length
        ? `Return status updated successfully. ${notes.join("; ")}.`
        : "Return status updated successfully",
      data: populatedReturn,
      restockedQuantity,
      walletCredited: refundResult?.walletCredited || 0,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Records that the replacement parcel has physically gone out.
 *
 * This is the step that did not exist. A replacement used to be closed out in one
 * click ("replaced"), which stamped a timestamp and restocked the returned unit
 * while the replacement parcel had not been packed — the operator believed the case
 * was finished, the customer had nothing to track, and the outbound unit was never
 * taken off the shelf.
 *
 * Order of operations, and each step is deliberate:
 *
 *   1. validate, and require a courier + AWB — without them the customer has
 *      nothing to track, which is the whole point of the state
 *   2. CLAIM the status transition (received → replacement_dispatched) with the
 *      expected status in the FILTER, so of two concurrent dispatches exactly one
 *      proceeds. Same primitive AdminUpdateReturnStatus uses.
 *   3. deduct the OUTBOUND unit, itself claim-first on replacementStockDeductedAt
 *   4. restock the INBOUND unit if its condition was resellable — unchanged
 *      behaviour, just moved to the moment the replacement actually ships
 *
 * If the deduction fails for want of stock, the status claim is RELEASED and the
 * dispatch is refused: a replacement must never read as dispatched when no unit was
 * available to send. Money is untouched throughout — no refund row, no gateway
 * call, no change to the order's paymentStatus, and no change to the original
 * order's shipment.
 */
/**
 * Shared preamble for both booking endpoints: capability, credentials, the return, and
 * the order behind it. Returns an error shape rather than throwing, so each caller keeps
 * its own status codes.
 */
const prepareReverseBooking = async (returnId) => {
  const capabilities = await getShippingCapabilities();
  if (!capabilities.permitted) {
    return { error: { status: 503, body: { success: false, message: "Shiprocket is disabled for this environment" } } };
  }
  if (!capabilities.shipments) {
    return { error: { status: 409, body: { success: false, message: "This store is set to manual fulfilment. Switch Shiprocket shipments on under Operations → Shipping." } } };
  }
  if (!capabilities.reverseShipments) {
    return {
      error: {
        status: 409,
        body: {
          success: false,
          message:
            "Booking return pickups and replacement parcels through Shiprocket is switched off. Enable it under Operations → Shipping, or record the courier and AWB by hand.",
          code: "REVERSE_SHIPMENTS_DISABLED",
        },
      },
    };
  }
  if (!capabilities.configured) {
    return { error: { status: 503, body: { success: false, message: "Shiprocket credentials are not saved" } } };
  }

  if (!mongoose.Types.ObjectId.isValid(returnId)) {
    return { error: { status: 400, body: { success: false, message: "Invalid return id" } } };
  }
  const returnRequest = await ReturnModel.findById(returnId);
  if (!returnRequest) {
    return { error: { status: 404, body: { success: false, message: "Return not found" } } };
  }
  // populate the customer email, which every Shiprocket shipment payload requires
  const order = await OrderModel.findById(returnRequest.order).populate("user", "email");
  if (!order) {
    return { error: { status: 404, body: { success: false, message: "The order behind this return no longer exists" } } };
  }
  return { returnRequest, order };
};

/**
 * Books a courier to collect the returned goods from the customer.
 *
 * Shiprocket is asked FIRST and the return only moves to `pickup_scheduled` once the
 * booking exists — the same ordering as the NDR action. Moving first would show
 * "pickup scheduled" for a collection no courier ever agreed to.
 */
export const BookReturnPickup = async (req, res) => {
  try {
    const prepared = await prepareReverseBooking(req.params.id);
    if (prepared.error) return res.status(prepared.error.status).json(prepared.error.body);
    const { returnRequest, order } = prepared;

    // Idempotent: a second click must not book a second courier to the same address.
    if (returnRequest.pickupAwb) {
      return res.status(200).json({
        success: true,
        message: "A pickup is already booked for this return.",
        alreadyBooked: true,
        pickupAwb: returnRequest.pickupAwb,
        pickupCourier: returnRequest.pickupCourier,
      });
    }
    if (returnRequest.status !== "approved") {
      return res.status(409).json({
        success: false,
        message: `A pickup can only be booked for an approved return. This one is ${returnRequest.status}.`,
        code: "RETURN_NOT_APPROVED",
      });
    }

    // The warehouse end of the journey. Resolved from Shiprocket's own pickup-location
    // list, so a name that is not registered there simply has no address and no pickup is
    // booked — the Phase A validation doing real work rather than only warning.
    const warehouse = await resolveWarehouseAddress();
    if (!warehouse.ok) {
      return res.status(409).json({
        success: false,
        message:
          "Your pickup location could not be resolved from Shiprocket, so there is no warehouse address to return the parcel to. Check Operations → Shipping.",
        code: "WAREHOUSE_ADDRESS_UNRESOLVED",
        reason: warehouse.reason,
      });
    }

    const booking = await createReturnPickup({ returnRequest, order, warehouse: warehouse.address });

    // Claim-in-filter on the source status, so two concurrent bookings cannot both move it.
    const claimed = await ReturnModel.findOneAndUpdate(
      { _id: returnRequest._id, status: "approved" },
      {
        $set: {
          status: "pickup_scheduled",
          pickupScheduledAt: new Date(),
          pickupShiprocketOrderId: booking.shiprocketOrderId,
          pickupShipmentId: booking.shipmentId,
        },
        $push: {
          statusHistory: {
            status: "pickup_scheduled",
            changedBy: req.user?.id || null,
            note: `Return pickup booked with Shiprocket (shipment ${booking.shipmentId})`,
          },
        },
      },
      { returnDocument: "after" },
    );

    if (!claimed) {
      // The courier booking exists but the return moved on. Logged loudly rather than
      // forced: overwriting whatever the concurrent change was would be worse, and the
      // shipment id is in the log so an operator can cancel it in Shiprocket.
      logLifecycleError(
        "returns",
        "return_pickup_booked_but_status_moved",
        new Error("Shiprocket booked the return pickup but the return was no longer approved"),
        { returnId: String(returnRequest._id), shipmentId: booking.shipmentId },
      );
      return res.status(409).json({
        success: false,
        message:
          "The pickup was booked, but this return had already moved on. Reload it — and cancel the duplicate shipment in Shiprocket if needed.",
        shipmentId: booking.shipmentId,
      });
    }

    logLifecycleEvent("returns", "return_pickup_booked", {
      returnId: String(claimed._id),
      shipmentId: booking.shipmentId,
    });
    return res.status(200).json({
      success: true,
      message: "Return pickup booked. Assign an AWB in Shiprocket to give the customer tracking.",
      returnRequest: claimed,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

/**
 * Books the outbound replacement parcel, WITHOUT dispatching the return.
 *
 * Deliberately separate from DispatchReplacement. That handler claims the status, deducts
 * outbound stock and rolls back if stock is short; adding an external booking inside it
 * would mean a Shiprocket failure had to unwind a stock movement too. Keeping them apart
 * means each step is independently retryable: book here, then dispatch as before — the
 * dispatch handler now falls back to whatever this stored.
 */
export const BookReplacementShipment = async (req, res) => {
  try {
    const prepared = await prepareReverseBooking(req.params.id);
    if (prepared.error) return res.status(prepared.error.status).json(prepared.error.body);
    const { returnRequest, order } = prepared;

    if (returnRequest.replacementAwb) {
      return res.status(200).json({
        success: true,
        message: "A replacement parcel is already booked for this return.",
        alreadyBooked: true,
        replacementAwb: returnRequest.replacementAwb,
        replacementCourier: returnRequest.replacementCourier,
      });
    }
    if (returnRequest.resolutionType !== "replacement") {
      return res.status(400).json({
        success: false,
        message: "This return is a refund, not a replacement",
        code: "NOT_A_REPLACEMENT",
      });
    }
    if (returnRequest.status !== "received") {
      return res.status(409).json({
        success: false,
        message: `A replacement parcel can only be booked once the returned item is marked "received". This return is ${returnRequest.status}.`,
        code: "RETURN_NOT_RECEIVED",
      });
    }

    const booking = await createReplacementShipment({ returnRequest, order });

    // No status change here — booking is not dispatching. The parcel is recorded so
    // DispatchReplacement can use it, and stock is still deducted there.
    const updated = await ReturnModel.findOneAndUpdate(
      { _id: returnRequest._id, status: "received", replacementAwb: { $exists: false } },
      {
        $set: {
          replacementShiprocketOrderId: booking.shiprocketOrderId,
          replacementShipmentId: booking.shipmentId,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      logLifecycleError(
        "returns",
        "replacement_booked_but_return_moved",
        new Error("Shiprocket booked the replacement but the return was no longer received/unbooked"),
        { returnId: String(returnRequest._id), shipmentId: booking.shipmentId },
      );
      return res.status(409).json({
        success: false,
        message:
          "The replacement was booked, but this return had already moved on. Reload it — and cancel the duplicate shipment in Shiprocket if needed.",
        shipmentId: booking.shipmentId,
      });
    }

    logLifecycleEvent("returns", "replacement_shipment_booked", {
      returnId: String(updated._id),
      shipmentId: booking.shipmentId,
    });
    return res.status(200).json({
      success: true,
      message:
        "Replacement parcel booked. Assign an AWB in Shiprocket, then dispatch the replacement to deduct stock and notify the customer.",
      returnRequest: updated,
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

export const DispatchReplacement = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    // Falls back to whatever BookReplacementShipment stored, so an admin who booked the
    // parcel through Shiprocket does not have to retype details the integration already
    // knows. Typing them by hand still works and still wins — manual dispatch is
    // unchanged.
    const booked = await ReturnModel.findById(req.params.id).select(
      "replacementCourier replacementAwb",
    );
    const courier = String(req.body?.courier || booked?.replacementCourier || "").trim();
    const awb = String(req.body?.awb || booked?.replacementAwb || "").trim();
    const disposition = String(req.body?.disposition || "").trim().toLowerCase();
    const dispositionNote = String(req.body?.dispositionNote || "").trim();
    const adminNote = String(req.body?.adminNote || "").trim();

    if (!courier || !awb) {
      return res.status(400).json({
        success: false,
        message:
          "Record the courier and the tracking (AWB) number for the replacement parcel — the customer is shown both.",
        code: "REPLACEMENT_TRACKING_REQUIRED",
      });
    }

    const returnRequest = await ReturnModel.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }
    if (returnRequest.resolutionType !== "replacement") {
      return res.status(400).json({
        success: false,
        message: "This return is a refund, not a replacement",
        code: "NOT_A_REPLACEMENT",
      });
    }
    if (returnRequest.status !== "received") {
      return res.status(409).json({
        success: false,
        message: `A replacement can only be dispatched once the returned item is marked "received". This return is ${returnRequest.status}.`,
        code: "RETURN_NOT_RECEIVED",
        currentStatus: returnRequest.status,
      });
    }
    // The inbound condition is still an independent decision from the customer's
    // resolution, and it still has no default — the same gate AdminUpdateReturnStatus
    // applies when resolving a refund.
    if (!["resellable", "damaged"].includes(disposition)) {
      return res.status(400).json({
        success: false,
        message:
          'Record the condition of the returned goods: "resellable" puts them back into stock, "damaged" writes them off. The customer gets their replacement either way.',
        code: "DISPOSITION_REQUIRED",
      });
    }

    // ─── CLAIM ───────────────────────────────────────────────────────────────
    // Everything above was validated against a document read a moment ago, so two
    // concurrent dispatches could both pass it. The expected status in the filter
    // means exactly one wins and only one can reach the stock movement below.
    const claimed = await ReturnModel.findOneAndUpdate(
      { _id: returnRequest._id, status: "received" },
      { $set: { status: "replacement_dispatched" } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      return res.status(409).json({
        success: false,
        message: "This return was updated by someone else a moment ago. Reload it and try again.",
        code: "RETURN_STATUS_CONFLICT",
      });
    }

    // ─── OUTBOUND STOCK ──────────────────────────────────────────────────────
    const deduction = await deductReplacementStock({ returnRequest: claimed });
    if (deduction.reason === "insufficient_stock") {
      // Release the claim. A dispatched replacement with no unit behind it would be
      // the same class of lie as a refund that never moved money.
      await ReturnModel.updateOne(
        { _id: claimed._id },
        { $set: { status: "received" } },
      );
      return res.status(409).json({
        success: false,
        message: `There is not enough stock to send ${deduction.quantity} replacement unit(s). Restock before dispatching.`,
        code: "INSUFFICIENT_REPLACEMENT_STOCK",
      });
    }

    claimed.replacementCourier = courier;
    claimed.replacementAwb = awb;
    claimed.replacementDispatchedAt = new Date();
    claimed.disposition = disposition;
    claimed.dispositionNote = dispositionNote;
    if (adminNote) claimed.adminNote = adminNote;
    claimed.statusHistory.push({
      status: "replacement_dispatched",
      changedBy: req.user.id,
      note: adminNote || `Dispatched via ${courier} (${awb})`,
    });
    await claimed.save();

    // ─── INBOUND STOCK ───────────────────────────────────────────────────────
    // Unchanged behaviour: restockReturnedItems refuses anything not explicitly
    // "resellable", and is claim-first on restockedAt. Together with the deduction
    // above, a resellable replacement nets zero stock movement and a damaged one
    // nets minus one.
    const restockedQuantity = await restockReturnedItems({ returnRequest: claimed });

    await notifyReturnUpdated({
      orderId: claimed.order,
      userId: claimed.user,
      status: "replacement_dispatched",
    });
    await createAuditLog({
      admin: req.user.id,
      action: "DISPATCH_REPLACEMENT",
      module: "RETURN",
      targetId: claimed._id,
      targetName: claimed.returnNumber,
      description:
        `Replacement dispatched via ${courier} (${awb}) — ${deduction.quantity || claimed.quantity} unit(s) out of stock` +
        (restockedQuantity > 0
          ? `, ${restockedQuantity} returned unit(s) back into stock`
          : `, returned goods written off as ${disposition}`),
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Replacement dispatched via ${courier}. Tracking: ${awb}.`,
      data: await populateReturnLean(ReturnModel.findById(claimed._id)),
      stockDeducted: deduction.deducted ? deduction.quantity : 0,
      restockedQuantity,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * Confirms the customer has received the replacement, closing the case.
 *
 * Records only a timestamp — no stock moves (the unit left the shelf at dispatch)
 * and no money moves (a replacement never involves any). Repeat confirmations lose
 * the status claim and get the same 409 the rest of the module uses.
 */
export const ConfirmReplacementDelivery = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid return id" });
    }

    const returnRequest = await ReturnModel.findById(req.params.id);
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: "Return not found" });
    }
    if (returnRequest.status !== "replacement_dispatched") {
      return res.status(409).json({
        success: false,
        message: `A replacement delivery can only be confirmed after it has been dispatched. This return is ${returnRequest.status}.`,
        code: "REPLACEMENT_NOT_DISPATCHED",
        currentStatus: returnRequest.status,
      });
    }

    const claimed = await ReturnModel.findOneAndUpdate(
      { _id: returnRequest._id, status: "replacement_dispatched" },
      { $set: { status: "replacement_delivered", replacementDeliveredAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      return res.status(409).json({
        success: false,
        message: "This return was updated by someone else a moment ago. Reload it and try again.",
        code: "RETURN_STATUS_CONFLICT",
      });
    }

    const adminNote = String(req.body?.adminNote || "").trim();
    if (adminNote) claimed.adminNote = adminNote;
    claimed.statusHistory.push({
      status: "replacement_delivered",
      changedBy: req.user.id,
      note: adminNote,
    });
    await claimed.save();

    await notifyReturnUpdated({
      orderId: claimed.order,
      userId: claimed.user,
      status: "replacement_delivered",
    });
    await createAuditLog({
      admin: req.user.id,
      action: "CONFIRM_REPLACEMENT_DELIVERY",
      module: "RETURN",
      targetId: claimed._id,
      targetName: claimed.returnNumber,
      description: `Replacement confirmed delivered${claimed.replacementAwb ? ` (${claimed.replacementAwb})` : ""}`,
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Replacement marked as delivered.",
      data: await populateReturnLean(ReturnModel.findById(claimed._id)),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
