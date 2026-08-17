import StockReservation from "../../model/StockReservation.model.js";
import {
  decrementStock,
  incrementStock,
  resolveVariantId,
} from "./variant.service.js";

const RESERVATION_TTL_MS = 20 * 60 * 1000;

// Re-exported so existing importers keep working; it is defined in
// variant.service.js, which owns everything variant-shaped.
export { getVariantKey } from "./variant.service.js";

/**
 * Holds stock for a checkout that is about to go to the payment gateway.
 *
 * The reservation ROW IS CREATED FIRST, before any stock is taken, and each item
 * is appended to it the instant that item's decrement succeeds. That ordering is
 * the fix for a permanent stock leak: the old version decremented every product
 * and only then created the row, so a crash mid-loop left units deducted with no
 * record of it anywhere — invisible to the customer, invisible to the admin, and
 * unreachable by the expiry cleanup job, which can only release reservations it
 * can find. Appending per item (rather than writing the whole list up front)
 * means the row always describes what was ACTUALLY taken, so releasing it can
 * never restock a unit that was never deducted.
 */
export const reserveStockForIntent = async ({
  userId,
  paymentIntentId,
  idempotencyKey,
  items,
}) => {
  const existingReservation = await StockReservation.findOne({
    user: userId,
    idempotencyKey,
    status: "active",
  });
  if (existingReservation) return existingReservation;

  const reservation = await StockReservation.create({
    user: userId,
    paymentIntent: paymentIntentId,
    idempotencyKey,
    items: [],
    status: "active",
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
  });

  const taken = [];
  try {
    for (const item of items) {
      // Variant-aware: the chosen variant's stock is constrained in the same
      // conditional update as the product total, so neither can go negative and
      // a sold-out variant of an in-stock product is refused.
      const variantId = await resolveVariantId(item.product, item.variantKey || "");
      const ok = await decrementStock({
        productId: item.product,
        quantity: item.quantity,
        variantId,
      });
      if (!ok) {
        const error = new Error(`${item.name} no longer has enough stock`);
        error.statusCode = 409;
        throw error;
      }

      const line = {
        product: item.product,
        variantKey: item.variantKey || "",
        name: item.name,
        quantity: item.quantity,
      };
      taken.push({ ...line, variantId });
      await StockReservation.updateOne(
        { _id: reservation._id },
        { $push: { items: line } },
      );
    }
  } catch (error) {
    // Give back only what this call actually took, then mark the row released so
    // the cleanup job doesn't restock it a second time.
    for (const line of taken) {
      await incrementStock({
        productId: line.product,
        quantity: line.quantity,
        variantId: line.variantId,
      });
    }
    await StockReservation.updateOne(
      { _id: reservation._id, status: "active" },
      { $set: { status: "released", releasedAt: new Date(), reason: "reserve_failed" } },
    );
    throw error;
  }

  return StockReservation.findById(reservation._id);
};

export const findActiveReservationForIntent = (paymentIntentId, session = null) => {
  const query = StockReservation.findOne({
    paymentIntent: paymentIntentId,
    status: "active",
    expiresAt: { $gt: new Date() },
  });
  return session ? query.session(session) : query;
};

/**
 * Converts an active reservation into a committed one.
 *
 * Returns null when nothing was claimed — which the caller MUST treat as a
 * failure, because it means the reservation expired or was released between the
 * stock check and here, so the order about to be created has no stock behind it.
 * The old caller discarded this result entirely.
 */
export const commitReservation = async ({ paymentIntentId, session }) =>
  StockReservation.findOneAndUpdate(
    { paymentIntent: paymentIntentId, status: "active" },
    {
      status: "committed",
      committedAt: new Date(),
      reason: "order_created",
    },
    { returnDocument: "after", session },
  );

/**
 * Returns reserved stock to the catalogue.
 *
 * The status flip is a compare-and-swap taken BEFORE any stock moves: the filter
 * requires `status: "active"`, so of two concurrent callers — a webhook retry and
 * the expiry cleanup job, say — exactly one gets the document and the other gets
 * null and does nothing. The old version read the reservation, restocked, and
 * only then saved the new status, so both callers passed the read and every unit
 * was restocked twice.
 */
export const releaseReservation = async ({ paymentIntentId, reason = "released" }) => {
  const reservation = await StockReservation.findOneAndUpdate(
    { paymentIntent: paymentIntentId, status: "active" },
    { $set: { status: "released", releasedAt: new Date(), reason } },
    { returnDocument: "after" },
  );
  if (!reservation) return null;

  for (const item of reservation.items) {
    await incrementStock({
      productId: item.product,
      quantity: item.quantity,
      variantId: await resolveVariantId(item.product, item.variantKey || ""),
    });
  }

  return reservation;
};
