import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeShippingAddress,
  orderError,
} from "../src/modules/orders/order-pricing.service.js";

test("normalizeShippingAddress accepts checkout aliases without losing fields", () => {
  const address = normalizeShippingAddress({
    name: "Aditya",
    mobile: "9876543210",
    line: "MG Road",
    city: "Delhi",
    state: "Delhi",
    pincode: "110001",
  });

  assert.deepEqual(address, {
    fullName: "Aditya",
    phone: "9876543210",
    address: "MG Road",
    city: "Delhi",
    state: "Delhi",
    pincode: "110001",
    country: "India",
  });
});

test("orderError carries an HTTP status code", () => {
  const error = orderError("Stock unavailable", 409);
  assert.equal(error.message, "Stock unavailable");
  assert.equal(error.statusCode, 409);
});
