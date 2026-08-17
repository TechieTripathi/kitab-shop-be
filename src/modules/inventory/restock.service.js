import { isStockEnforced } from "../../config/features.config.js";
import OrderModel from "../orders/Order.model.js";
import ReturnModel from "../returns/return.model.js";
import { decrementStock, incrementStock, resolveVariantId } from "./variant.service.js";

/**
 * Putting physically-returned goods back on sale.
 *
 * Neither of the two ways stock comes back to the warehouse used to increment
 * anything: an approved return and an RTO parcel were both written off, so the
 * catalogue under-counted its real inventory permanently and only a manual
 * inventory edit could correct it.
 *
 * Both entry points here are CLAIM-FIRST and therefore idempotent. The claim is a
 * conditional update on a timestamp field that only succeeds while the timestamp
 * is still null; the stock increment happens after the claim wins. That ordering
 * matters because the triggers are a courier webhook (which Shiprocket retries)
 * and an admin button (which gets double-clicked) — a read-then-write check would
 * let two deliveries of one event both restock, inflating the catalogue and
 * overselling. A crash between claim and increment loses one restock, which an
 * admin can see and correct; a double increment silently oversells.
 *
 * Restock quantities respect variant selection when the order line carries one,
 * so a returned "Large / Red" goes back to that variant rather than to the
 * generic pool. Both counters are moved, mirroring how they are decremented.
 */

/**
 * Adds `quantity` back to a product's stock, and to the matching variant's stock
 * when the order line names one.
 */
const restockLine = async ({ productId, quantity, variantKey, session = null }) => {
  if (!(quantity > 0)) return;

  // incrementStock moves the product counter and the chosen variant's counter in
  // one update, and falls back to product level if that variant has since been
  // deleted from the catalogue.
  await incrementStock({
    productId,
    quantity,
    variantId: await resolveVariantId(productId, variantKey),
    session,
  });
};

/**
 * Restocks the goods covered by one return request, after QC has passed.
 *
 * Called when a return reaches "refunded" or "replaced" — never "rejected",
 * because a QC rejection means the item came back damaged, used, or wrong, and
 * putting that back on sale would ship a customer a known-bad unit.
 *
 * Returns the quantity restocked (0 if it had already been claimed).
 */
export const restockReturnedItems = async ({ returnRequest }) => {
  if (!isStockEnforced()) return 0;

  const quantity = Number(returnRequest?.quantity) || 0;
  if (quantity <= 0 || !returnRequest?.product) return 0;

  // The DISPOSITION decides this, not the resolution. A refunded return whose
  // goods came back damaged must not be restocked — previously any refunded or
  // replaced return restocked unconditionally, so a faulty item the customer was
  // rightly refunded for went straight back on sale. Anything other than an
  // explicit "resellable" is written off.
  if (returnRequest.disposition !== "resellable") return 0;

  // The claim: only the first caller sees restockedAt still unset.
  const claimed = await ReturnModel.findOneAndUpdate(
    {
      _id: returnRequest._id,
      $or: [{ restockedAt: null }, { restockedAt: { $exists: false } }],
    },
    { $set: { restockedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return 0;

  // The order line is what knows which variant was bought; the return request
  // only records the product.
  const order = await OrderModel.findById(returnRequest.order).select("items");
  const line = order?.items?.find(
    (item) => String(item.product) === String(returnRequest.product),
  );

  await restockLine({
    productId: returnRequest.product,
    quantity,
    variantKey: line?.variantKey || "",
  });

  if (returnRequest.restockedAt !== undefined) {
    returnRequest.restockedAt = claimed.restockedAt;
  }
  return quantity;
};

/**
 * Restocks a whole order once its RTO parcel is physically back with the seller.
 *
 * Deliberately keyed on the parcel ARRIVING, not on the order entering "RTO":
 * Shiprocket reports "RTO Initiated" and "RTO In Transit" long before the goods
 * reach the warehouse, and restocking then would sell inventory that is still on
 * a truck.
 *
 * Units already cancelled are excluded — CancelOrder restocked those at
 * cancellation time, so counting them again would double-count.
 *
 * Returns the total quantity restocked (0 if already claimed).
 */
export const restockRtoOrder = async ({ orderId, disposition }) => {
  if (!isStockEnforced()) return 0;

  // An RTO parcel is inspected on arrival like any return. A courier can damage a
  // box in both directions, and this path used to restock every non-cancelled unit
  // blind the moment the webhook reported arrival.
  if (disposition !== "resellable") return 0;

  const claimed = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      $or: [{ rtoRestockedAt: null }, { rtoRestockedAt: { $exists: false } }],
    },
    { $set: { rtoRestockedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return 0;

  let restocked = 0;
  for (const item of claimed.items || []) {
    const quantity = Math.max(
      0,
      (Number(item.quantity) || 0) - (Number(item.cancelledQuantity) || 0),
    );
    if (quantity <= 0) continue;
    await restockLine({
      productId: item.product,
      quantity,
      variantKey: item.variantKey || "",
    });
    restocked += quantity;
  }

  return restocked;
};

/**
 * Takes the OUTBOUND replacement unit off the shelf when a replacement is dispatched.
 *
 * The counterpart to restockReturnedItems, and it did not exist. Dispatching a
 * replacement sends a second physical unit to the customer, and nothing deducted it:
 * `decrementStock` was only ever called at checkout, on reservation and at payment
 * capture. So every completed replacement inflated sellable stock by its own
 * quantity, in BOTH dispositions:
 *
 *   resellable  −1 sale +1 restock          = system unchanged, shelf down 1
 *   damaged     −1 sale, write-off          = system down 1,    shelf down 2
 *
 * With this, the invariant closes: a resellable return that is replaced nets zero
 * (the unit that came back is the unit that goes out), and a damaged one nets −1
 * (the returned unit is written off and a fresh one leaves).
 *
 * CLAIM-FIRST, exactly like restockReturnedItems: `replacementStockDeductedAt` is
 * stamped by a conditional update that only succeeds while it is still null, and the
 * stock only moves once that claim is won. A double-clicked dispatch button or a
 * retried request therefore deducts once. The ordering is deliberate in the same
 * direction too — a crash between claim and decrement loses one deduction, which an
 * operator can see and correct, whereas a double decrement silently oversells.
 *
 * Returns false when there is not enough stock, WITHOUT having moved anything, so the
 * caller can refuse the dispatch. The claim is released in that case.
 *
 * @returns {{deducted: boolean, quantity: number, reason?: string}}
 */
export const deductReplacementStock = async ({ returnRequest }) => {
  if (!isStockEnforced()) return { deducted: false, quantity: 0, reason: "stock_not_enforced" };

  const quantity = Number(returnRequest?.quantity) || 0;
  if (quantity <= 0 || !returnRequest?.product) {
    return { deducted: false, quantity: 0, reason: "nothing_to_deduct" };
  }

  const claimed = await ReturnModel.findOneAndUpdate(
    {
      _id: returnRequest._id,
      $or: [
        { replacementStockDeductedAt: null },
        { replacementStockDeductedAt: { $exists: false } },
      ],
    },
    { $set: { replacementStockDeductedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) return { deducted: false, quantity: 0, reason: "already_deducted" };

  // The order line is what knows which variant was bought; the return request only
  // records the product. Same lookup restockReturnedItems uses, so the replacement
  // leaves the same variant pool the original came out of.
  const order = await OrderModel.findById(returnRequest.order).select("items");
  const line = order?.items?.find(
    (item) => String(item.product) === String(returnRequest.product),
  );

  const ok = await decrementStock({
    productId: returnRequest.product,
    quantity,
    variantId: await resolveVariantId(returnRequest.product, line?.variantKey || ""),
  });

  if (!ok) {
    // Nothing moved. Release the claim so a later dispatch, once stock exists, can
    // still deduct — leaving it stamped would let the replacement ship untracked.
    await ReturnModel.updateOne(
      { _id: returnRequest._id },
      { $set: { replacementStockDeductedAt: null } },
    );
    return { deducted: false, quantity, reason: "insufficient_stock" };
  }

  return { deducted: true, quantity };
};
