import cartModel from "./cart.model.js";
import OrderModel from "../orders/Order.model.js";
import { logLifecycleError, logLifecycleEvent } from "../../utils/lifecycle-logger.service.js";

/**
 * Removes the items a confirmed order bought from the customer's cart.
 *
 * Cart clearing used to happen only in the browser, in Checkout.jsx's
 * `completeOrder`. That is wrong for the same reason the Razorpay webhook exists:
 * when the shopper closes the tab or loses signal after paying, the webhook
 * confirms the order and the browser never runs its success flow — so the cart
 * kept everything that had just been bought. The customer then sees their
 * purchase still sitting in the cart, and the abandoned-cart report will happily
 * email them a recovery nudge for an order they already paid for.
 *
 * ── Why per-line, and not `cart.items = []` ─────────────────────────────────
 * The cart stays live during payment. A shopper can add something in another tab
 * while a Razorpay window is open, and that item is not part of the order.
 * Wiping the cart would silently throw it away. Lines are therefore matched on
 * `(product, variantKey)` — the same identity `findCartItem` uses — and the
 * ordered quantity is SUBTRACTED, so a line the shopper increased mid-payment
 * keeps its remainder instead of vanishing.
 *
 * ── Why claim-first ────────────────────────────────────────────────────────
 * Subtraction is not idempotent, and this runs on a path that genuinely executes
 * more than once: a browser verify and a `payment.captured` webhook can arrive
 * together, and both reach the post-commit block. `order.cartClearedAt` is
 * claimed with the precondition in the filter, so exactly one execution ever
 * subtracts.
 *
 * The claim is taken BEFORE the cart is touched, which means a crash in between
 * leaves items in the cart that were actually bought. That direction is chosen on
 * purpose: an over-full cart is cosmetic and the customer can remove the line,
 * whereas subtracting twice would delete items they still intend to buy. Same
 * reasoning as `restoreWalletCredit` — under-doing it is recoverable, over-doing
 * it destroys something real.
 *
 * Never throws. It is called after the order is durably committed, so a failure
 * here must not turn a successful payment into an error response or make the
 * webhook answer 5xx and retry a confirmation that already happened.
 *
 * @returns {{cleared: boolean, alreadyCleared?: boolean, removed?: number, reduced?: number}}
 */
export const clearOrderedItemsFromCart = async ({ order }) => {
  try {
    if (!order?._id || !order?.user) return { cleared: false };

    // ── CLAIM ──────────────────────────────────────────────────────────────
    // Filter carries the precondition, so a verify/webhook race or a replayed
    // delivery subtracts once rather than once per execution.
    const claimed = await OrderModel.findOneAndUpdate(
      {
        _id: order._id,
        $or: [{ cartClearedAt: null }, { cartClearedAt: { $exists: false } }],
      },
      { $set: { cartClearedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!claimed) return { cleared: false, alreadyCleared: true };

    const cart = await cartModel.findOne({ user: order.user });
    if (!cart || cart.items.length === 0) return { cleared: true, removed: 0, reduced: 0 };

    // Sum per (product, variantKey): an order may legitimately carry the same
    // product and variant on two lines, and each one was paid for.
    const orderedByLine = new Map();
    for (const item of order.items || []) {
      const key = `${item.product}|${item.variantKey || ""}`;
      orderedByLine.set(key, (orderedByLine.get(key) || 0) + (Number(item.quantity) || 0));
    }

    let removed = 0;
    let reduced = 0;
    const surviving = [];

    for (const line of cart.items) {
      const key = `${line.product}|${line.variantKey || ""}`;
      const orderedQuantity = orderedByLine.get(key) || 0;

      // Not in this order — e.g. added while the payment window was open.
      if (orderedQuantity <= 0) {
        surviving.push(line);
        continue;
      }

      const remaining = (Number(line.quantity) || 0) - orderedQuantity;
      if (remaining > 0) {
        line.quantity = remaining;
        surviving.push(line);
        reduced += 1;
      } else {
        removed += 1;
      }
    }

    if (removed === 0 && reduced === 0) return { cleared: true, removed: 0, reduced: 0 };

    cart.items = surviving;
    await cart.save();

    logLifecycleEvent("cart", "ordered_items_cleared", {
      orderId: order._id,
      removed,
      reduced,
      remainingLines: surviving.length,
    });

    return { cleared: true, removed, reduced };
  } catch (error) {
    // The order is already committed and the payment already captured. A cart
    // problem must not surface as a failed checkout, so this is logged and
    // swallowed — the worst outcome is a stale cart line.
    logLifecycleError("cart", "ordered_items_clear_failed", error, {
      orderId: order?._id,
      userId: order?.user,
    });
    return { cleared: false, failed: true };
  }
};
