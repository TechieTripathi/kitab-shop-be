import ProductModel from "../products/Product.model.js";
import StockReservation from "../../model/StockReservation.model.js";
import { logLifecycleEvent, logLifecycleError } from "../../utils/lifecycle-logger.service.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer = null;

const readIntervalMs = () => {
  const configured = Number(process.env.INVENTORY_RESERVATION_CLEANUP_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured < 60_000) return DEFAULT_INTERVAL_MS;
  return configured;
};

export const cleanupExpiredStockReservations = async ({ limit = 100 } = {}) => {
  const now = new Date();
  let processed = 0;

  while (processed < limit) {
    const reservation = await StockReservation.findOneAndUpdate(
      {
        status: "active",
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: "expired",
          releasedAt: now,
          reason: "reservation_expired",
        },
      },
      {
        sort: { expiresAt: 1 },
        returnDocument: "before",
      },
    );

    if (!reservation) break;

    await Promise.all(
      reservation.items.map((item) =>
        ProductModel.updateOne(
          { _id: item.product },
          { $inc: { stock: item.quantity } },
        ),
      ),
    );
    processed += 1;
  }

  return processed;
};

export const startStockReservationCleanup = () => {
  if (cleanupTimer) return cleanupTimer;
  if (process.env.INVENTORY_RESERVATION_CLEANUP_ENABLED === "false") return null;

  const runCleanup = async () => {
    try {
      const count = await cleanupExpiredStockReservations();
      if (count > 0) {
        logLifecycleEvent("inventory", "expired_reservations_released", { count });
      }
    } catch (error) {
      logLifecycleError("inventory", "reservation_cleanup_failed", error);
    }
  };

  cleanupTimer = setInterval(runCleanup, readIntervalMs());
  cleanupTimer.unref?.();
  runCleanup();
  return cleanupTimer;
};
