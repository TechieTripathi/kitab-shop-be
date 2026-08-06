const DEFAULT_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_LIFETIME_MS = 9 * 24 * 60 * 60 * 1000;

let cachedToken = null;
let tokenExpiresAt = 0;
let pendingLogin = null;

export class ShiprocketError extends Error {
  constructor(message, statusCode = 502, details = null) {
    super(message);
    this.name = "ShiprocketError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const isShiprocketConfigured = () =>
  Boolean(
    String(process.env.SHIPROCKET_EMAIL || "").trim() &&
      String(process.env.SHIPROCKET_PASSWORD || "").trim(),
  );

const getConfig = () => {
  const email = String(process.env.SHIPROCKET_EMAIL || "").trim();
  const password = String(process.env.SHIPROCKET_PASSWORD || "").trim();
  const baseUrl = String(process.env.SHIPROCKET_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  if (!email || !password) {
    throw new ShiprocketError("Shiprocket credentials are not configured", 503);
  }

  return { email, password, baseUrl };
};

const readResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getErrorMessage = (data, fallback) => {
  if (typeof data?.message === "string") return data.message;
  if (typeof data?.error === "string") return data.error;
  if (data?.errors && typeof data.errors === "object") {
    return Object.values(data.errors).flat().join(", ");
  }
  return fallback;
};

const login = async () => {
  const { email, password, baseUrl } = getConfig();
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await readResponse(response);

  if (!response.ok || !data.token) {
    throw new ShiprocketError(
      getErrorMessage(data, "Shiprocket authentication failed"),
      response.status === 401 || response.status === 422 ? 502 : 503,
      data,
    );
  }

  cachedToken = data.token;
  tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
  return cachedToken;
};

const getToken = async (forceRefresh = false) => {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (!pendingLogin) {
    pendingLogin = login().finally(() => {
      pendingLogin = null;
    });
  }
  return pendingLogin;
};

const request = async (path, { method = "GET", body, query } = {}, retry = true) => {
  const { baseUrl } = getConfig();
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const token = await getToken();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new ShiprocketError(`Shiprocket is unreachable: ${error.message}`, 503);
  }

  if (response.status === 401 && retry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    await getToken(true);
    return request(path, { method, body, query }, false);
  }

  const data = await readResponse(response);
  if (!response.ok) {
    throw new ShiprocketError(
      getErrorMessage(data, `Shiprocket request failed with status ${response.status}`),
      response.status === 429 ? 503 : 502,
      data,
    );
  }

  // Some Shiprocket endpoints return HTTP 200 even when their JSON payload
  // represents a validation failure (for example: { status: 400, message: ... }).
  const embeddedStatus = Number(data?.status);
  const embeddedStatusCode = Number(data?.status_code);
  const logicalErrorCode =
    (Number.isFinite(embeddedStatus) && embeddedStatus >= 400 && embeddedStatus) ||
    (Number.isFinite(embeddedStatusCode) &&
      embeddedStatusCode >= 400 &&
      embeddedStatusCode) ||
    null;
  if (data?.success === false || logicalErrorCode) {
    throw new ShiprocketError(
      getErrorMessage(data, "Shiprocket rejected the request"),
      logicalErrorCode >= 400 && logicalErrorCode < 500 ? 400 : 502,
      data,
    );
  }

  return data;
};

const positiveNumber = (value, fallback, field) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ShiprocketError(`${field} must be a positive number`, 400);
  }
  return parsed;
};

export const resolvePackage = (overrides = {}) => ({
  length: positiveNumber(overrides.length, process.env.SHIPROCKET_DEFAULT_LENGTH_CM || 10, "length"),
  breadth: positiveNumber(
    overrides.breadth,
    process.env.SHIPROCKET_DEFAULT_BREADTH_CM || 10,
    "breadth",
  ),
  height: positiveNumber(overrides.height, process.env.SHIPROCKET_DEFAULT_HEIGHT_CM || 10, "height"),
  weight: positiveNumber(overrides.weight, process.env.SHIPROCKET_DEFAULT_WEIGHT_KG || 0.5, "weight"),
});

const formatOrderDate = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
};

const splitName = (fullName) => {
  const parts = String(fullName || "Customer").trim().split(/\s+/);
  return {
    firstName: parts.shift() || "Customer",
    lastName: parts.join(" "),
  };
};

export const createShiprocketOrder = async (order, packageOverrides = {}) => {
  const packageDetails = resolvePackage(packageOverrides);
  const address = order.shippingAddress;
  const customer = splitName(address.fullName);
  const email = order.user?.email;

  if (!email) {
    throw new ShiprocketError("Customer email is required to create a Shiprocket order", 400);
  }

  const payload = {
    order_id: String(order._id),
    order_date: formatOrderDate(order.createdAt),
    pickup_location: String(process.env.SHIPROCKET_PICKUP_LOCATION || "Primary").trim(),
    billing_customer_name: customer.firstName,
    billing_last_name: customer.lastName,
    billing_address: address.address,
    billing_city: address.city,
    billing_pincode: address.pincode,
    billing_state: address.state,
    billing_country: address.country || "India",
    billing_email: email,
    billing_phone: address.phone,
    shipping_is_billing: true,
    order_items: order.items.map((item) => ({
      name: item.name,
      sku: String(item.product?._id || item.product),
      units: item.quantity,
      selling_price: item.price,
      discount: 0,
      tax: 0,
      hsn: "",
    })),
    payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",
    shipping_charges: order.shippingCharge || 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: order.discount || 0,
    sub_total: Math.max(0, order.totalAmount - (order.shippingCharge || 0)),
    ...packageDetails,
  };

  const data = await request("/orders/create/adhoc", {
    method: "POST",
    body: payload,
  });

  const shiprocketOrderId = Number(data?.order_id);
  const shipmentId = Number(data?.shipment_id);
  if (
    !Number.isFinite(shiprocketOrderId) ||
    shiprocketOrderId <= 0 ||
    !Number.isFinite(shipmentId) ||
    shipmentId <= 0
  ) {
    throw new ShiprocketError(
      getErrorMessage(data, "Shiprocket did not return an order ID and shipment ID"),
      502,
      data,
    );
  }

  return { data, packageDetails, shiprocketOrderId, shipmentId };
};

export const checkServiceability = (params) =>
  request("/courier/serviceability/", {
    query: {
      pickup_postcode: params.pickupPostcode || process.env.SHIPROCKET_PICKUP_POSTCODE,
      delivery_postcode: params.deliveryPostcode,
      cod: params.cod ? 1 : 0,
      weight: params.weight,
      length: params.length,
      breadth: params.breadth,
      height: params.height,
      declared_value: params.declaredValue,
      mode: params.mode,
    },
  });

export const assignAwb = (shipmentId, courierId) =>
  request("/courier/assign/awb", {
    method: "POST",
    body: {
      shipment_id: shipmentId,
      ...(courierId ? { courier_id: Number(courierId) } : {}),
    },
  });

export const schedulePickup = (shipmentId, pickupDate) =>
  request("/courier/generate/pickup", {
    method: "POST",
    body: {
      shipment_id: [Number(shipmentId)],
      ...(pickupDate ? { pickup_date: [pickupDate] } : {}),
    },
  });

export const generateLabel = (shipmentId) =>
  request("/courier/generate/label", {
    method: "POST",
    body: { shipment_id: [Number(shipmentId)] },
  });

export const generateInvoice = (shiprocketOrderId) =>
  request("/orders/print/invoice", {
    method: "POST",
    body: { ids: [Number(shiprocketOrderId)] },
  });

export const trackAwb = (awbCode) =>
  request(`/courier/track/awb/${encodeURIComponent(awbCode)}`);

export const cancelShiprocketOrder = (shiprocketOrderId) =>
  request("/orders/cancel", {
    method: "POST",
    body: { ids: [Number(shiprocketOrderId)] },
  });
