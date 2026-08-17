import OrderModel from "../orders/Order.model.js";

/**
 * Cash-on-Delivery reconciliation — read-only.
 *
 * COD collection in this system is INFERRED, never verified: the delivery webhook flips
 * `paymentStatus: Pending → Paid` when Shiprocket reports the parcel delivered
 * (shipping.controller.js). Nothing ever checks that cash actually reached the account.
 * That inference has four failure modes, and each one is money:
 *
 *   uncollected   Delivered, but still Pending. The webhook was off, lost, or raced, so
 *                 cash was collected at the door and this system does not know. Revenue
 *                 you are owed and are not counting.
 *
 *   phantom       Marked Paid without ever being Delivered. Cash recorded for a parcel
 *                 that never reached the customer — revenue that does not exist.
 *
 *   rtoStillPaid  Came back to you (RTO) but still marked Paid. The parcel is on your
 *                 shelf AND booked as collected cash. Also creates a refund obligation
 *                 for money that was never taken.
 *
 *   missingDate   Delivered and Paid, but no deliveredAt. Not a money error — the return
 *                 and replacement windows count down from that timestamp, so without it
 *                 the eligibility maths has no origin.
 *
 * Deliberately read-only and deliberately local. It writes nothing and fixes nothing,
 * because every one of these needs a human decision: "uncollected" might be a webhook
 * outage or might be a courier who never handed the money over, and those have opposite
 * remedies. It also makes no Shiprocket call — TRUE remittance matching ("Shiprocket says
 * ₹X arrived on this date") needs their statements API, which is not integrated. Until it
 * is, this is the local half: it tells an operator exactly which orders to look up in
 * Shiprocket's own remittance report instead of reconciling the whole ledger by hand.
 */

// Money is considered collected once paymentStatus says so. Refunded states are excluded
// from "phantom" because a refund legitimately follows collection.
const PAID_STATES = ["Paid", "Partially Refunded", "Refund Pending", "Refunded"];
const RTO_STATES = ["RTO", "RTO In Transit", "RTO Received", "Closed"];

const summarise = (orders) => ({
  count: orders.length,
  amount: orders.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0),
  orders,
});

const project = {
  _id: 1,
  orderStatus: 1,
  paymentStatus: 1,
  totalAmount: 1,
  deliveredAt: 1,
  createdAt: 1,
  "shiprocket.awbCode": 1,
  "shiprocket.courierName": 1,
  "shipment.trackingNumber": 1,
  "shipment.carrierName": 1,
};

export const buildCodReconciliation = async ({ limit = 200 } = {}) => {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const cod = { paymentMethod: "COD" };

  const [uncollected, phantom, rtoStillPaid, missingDate, totals] = await Promise.all([
    // Delivered is the trigger for the flip, so Delivered-but-Pending means the trigger
    // never fired. Oldest first: the longer it has sat, the colder the trail.
    OrderModel.find({ ...cod, orderStatus: "Delivered", paymentStatus: "Pending" }, project)
      .sort({ deliveredAt: 1, createdAt: 1 })
      .limit(cap)
      .lean(),

    // Paid without ever having been delivered. Cancelled is excluded: a cancelled COD
    // order that shows Paid is a refund-ledger question, not a collection one.
    OrderModel.find(
      {
        ...cod,
        paymentStatus: { $in: PAID_STATES },
        deliveredAt: null,
        orderStatus: { $nin: ["Delivered", "Cancelled", ...RTO_STATES] },
      },
      project,
    )
      .sort({ createdAt: 1 })
      .limit(cap)
      .lean(),

    OrderModel.find(
      { ...cod, orderStatus: { $in: RTO_STATES }, paymentStatus: { $in: PAID_STATES } },
      project,
    )
      .sort({ createdAt: 1 })
      .limit(cap)
      .lean(),

    OrderModel.find(
      { ...cod, orderStatus: "Delivered", paymentStatus: { $in: PAID_STATES }, deliveredAt: null },
      project,
    )
      .sort({ createdAt: 1 })
      .limit(cap)
      .lean(),

    OrderModel.aggregate([
      { $match: cod },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          collected: {
            $sum: { $cond: [{ $in: ["$paymentStatus", PAID_STATES] }, "$totalAmount", 0] },
          },
          awaiting: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "Pending"] }, "$totalAmount", 0] },
          },
        },
      },
    ]),
  ]);

  const buckets = {
    uncollected: summarise(uncollected),
    phantom: summarise(phantom),
    rtoStillPaid: summarise(rtoStillPaid),
    missingDate: summarise(missingDate),
  };

  return {
    // `capped` is explicit rather than silent: a truncated list that looks complete is
    // how a reconciliation report ends up under-reporting the problem it exists to find.
    limit: cap,
    capped: Object.values(buckets).some((bucket) => bucket.count === cap),
    totals: {
      codOrders: totals[0]?.orders || 0,
      recordedCollected: totals[0]?.collected || 0,
      awaitingCollection: totals[0]?.awaiting || 0,
    },
    buckets,
    // Money at risk in either direction, which is the number worth acting on.
    discrepancyAmount:
      buckets.uncollected.amount + buckets.phantom.amount + buckets.rtoStillPaid.amount,
    remittanceMatched: false,
    note:
      "Derived from this system's own records. Shiprocket's remittance/statements API is not integrated, so amounts are not matched against cash actually received.",
  };
};
