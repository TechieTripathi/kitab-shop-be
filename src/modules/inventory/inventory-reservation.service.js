import ProductModel from "../products/Product.model.js";
import StockReservation from "../../model/StockReservation.model.js";

const RESERVATION_TTL_MS = 20 * 60 * 1000;

export const getVariantKey = (selectedVariants = {}) => {
  if (!selectedVariants || typeof selectedVariants !== "object") return "";
  return Object.keys(selectedVariants)
    .sort()
    .map((key) => `${key}:${selectedVariants[key]}`)
    .join("|");
};

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

  const reservedItems = [];
  for (const item of items) {
    const stockUpdate = await ProductModel.updateOne(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
    );
    if (stockUpdate.modifiedCount !== 1) {
      for (const reservedItem of reservedItems) {
        await ProductModel.updateOne(
          { _id: reservedItem.product },
          { $inc: { stock: reservedItem.quantity } },
        );
      }
      const error = new Error(`${item.name} no longer has enough stock`);
      error.statusCode = 409;
      throw error;
    }

    reservedItems.push({
      product: item.product,
      variantKey: item.variantKey || "",
      name: item.name,
      quantity: item.quantity,
    });
  }

  try {
    return await StockReservation.create({
      user: userId,
      paymentIntent: paymentIntentId,
      idempotencyKey,
      items: reservedItems,
      status: "active",
      expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
    });
  } catch (error) {
    for (const item of reservedItems) {
      await ProductModel.updateOne(
        { _id: item.product },
        { $inc: { stock: item.quantity } },
      );
    }
    throw error;
  }
};

export const findActiveReservationForIntent = (paymentIntentId) =>
  StockReservation.findOne({
    paymentIntent: paymentIntentId,
    status: "active",
    expiresAt: { $gt: new Date() },
  });

export const commitReservation = async ({ paymentIntentId, session }) =>
  StockReservation.findOneAndUpdate(
    { paymentIntent: paymentIntentId, status: "active" },
    {
      status: "committed",
      committedAt: new Date(),
      reason: "order_created",
    },
    { new: true, session },
  );

export const releaseReservation = async ({ paymentIntentId, reason = "released" }) => {
  const reservation = await StockReservation.findOne({
    paymentIntent: paymentIntentId,
    status: "active",
  });
  if (!reservation) return null;

  for (const item of reservation.items) {
    await ProductModel.updateOne(
      { _id: item.product },
      { $inc: { stock: item.quantity } },
    );
  }

  reservation.status = "released";
  reservation.releasedAt = new Date();
  reservation.reason = reason;
  await reservation.save();
  return reservation;
};

