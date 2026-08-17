import ShiprocketSetting from "./ShiprocketSetting.model.js";
import { getFeatures, isShippingEnabled } from "../../config/features.config.js";
import {
  clearPickupLocationCache,
  getShippingCapabilities,
  listPickupLocations,
  verifyShiprocketConnection,
} from "./shiprocket.service.js";

// Password/webhook token are write-only from the client's point of view —
// GET reports whether one is set, never the value itself, so a saved
// credential is never re-displayed once submitted.
const presentSettings = (settings) => ({
  email: settings.email,
  passwordSet: Boolean(settings.password),
  pickupLocation: settings.pickupLocation,
  pickupPostcode: settings.pickupPostcode,
  webhookTokenSet: Boolean(settings.webhookToken),
  defaultLengthCm: settings.defaultLengthCm,
  defaultBreadthCm: settings.defaultBreadthCm,
  defaultHeightCm: settings.defaultHeightCm,
  defaultWeightKg: settings.defaultWeightKg,
  // The admin's capability choices. Reported raw (what they picked), separately from
  // `capabilities` below (what that resolves to once the .env ceiling is applied), so
  // the UI can show a switch as ON-but-blocked instead of silently flipping it off.
  shipmentsEnabled: settings.shipmentsEnabled !== false,
  autoPushEnabled: settings.autoPushEnabled !== false,
  deliveryWebhookEnabled: settings.deliveryWebhookEnabled !== false,
  // `=== true`, matching the resolver: absent means never opted in, not enabled.
  reverseShipmentsEnabled: settings.reverseShipmentsEnabled === true,
});

// One helper for both handlers — the two used to hand-build the same object and could
// drift. `capabilities` is what the server will actually do; `status` is the .env
// ceiling, kept for the existing status pills.
const presentStatus = async () => {
  const { shipping } = getFeatures();
  const capabilities = await getShippingCapabilities();
  return {
    status: {
      enabled: isShippingEnabled(),
      configured: capabilities.configured,
      autoCreateOrder: Boolean(shipping.autoCreateOrder),
      webhookEnabled: capabilities.deliveryWebhook,
    },
    // What .env permits, independent of the admin's choice. The UI disables a switch
    // and explains why when the ceiling forbids it, rather than letting an admin turn
    // on something that cannot take effect.
    envCeiling: {
      shipments: isShippingEnabled(),
      autoPush: isShippingEnabled() && Boolean(shipping.autoCreateOrder),
      deliveryWebhook: isShippingEnabled() && Boolean(shipping.webhookEnabled),
      // No env flag of its own — it inherits the shipments ceiling, so the panel is the
      // only place it is decided.
      reverseShipments: isShippingEnabled(),
    },
    capabilities,
  };
};

export const GetShiprocketSettings = async (req, res) => {
  try {
    const settings = await ShiprocketSetting.getSettings();

    return res.status(200).json({
      success: true,
      settings: presentSettings(settings),
      ...(await presentStatus()),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const STRING_FIELDS = ["email", "pickupLocation", "pickupPostcode"];
const SECRET_FIELDS = ["password", "webhookToken"];
const NUMBER_FIELDS = ["defaultLengthCm", "defaultBreadthCm", "defaultHeightCm", "defaultWeightKg"];
// Booleans only, like the COD coverage mode: a junk value must leave the admin's
// existing choice alone rather than being coerced into switching fulfilment off.
const CAPABILITY_FIELDS = [
  "shipmentsEnabled",
  "autoPushEnabled",
  "deliveryWebhookEnabled",
  "reverseShipmentsEnabled",
];

export const UpdateShiprocketSettings = async (req, res) => {
  try {
    const settings = await ShiprocketSetting.getSettings();
    const body = req.body || {};

    for (const field of STRING_FIELDS) {
      if (typeof body[field] === "string") settings[field] = body[field].trim();
    }
    // A blank secret field means "leave it as-is" — only overwrite when the
    // admin actually typed a new value, so re-saving the form (with the
    // field shown blank, since it's never sent back) doesn't wipe it.
    let credentialsChanged = typeof body.email === "string" && body.email.trim() !== String(settings.email ?? "").trim();
    for (const field of SECRET_FIELDS) {
      if (typeof body[field] === "string" && body[field].trim()) {
        settings[field] = body[field].trim();
        if (field === "password") credentialsChanged = true;
      }
    }
    // The cached pickup list belongs to whichever account those credentials pointed at.
    // Keeping it after a credential change would have System Health validating the pickup
    // name against a different Shiprocket account's locations.
    if (credentialsChanged) clearPickupLocationCache();
    for (const field of NUMBER_FIELDS) {
      const value = Number(body[field]);
      if (Number.isFinite(value) && value >= 0) settings[field] = value;
    }
    for (const field of CAPABILITY_FIELDS) {
      if (typeof body[field] === "boolean") settings[field] = body[field];
    }

    await settings.save();
    return res.status(200).json({
      success: true,
      message: "Shiprocket settings updated successfully",
      settings: presentSettings(settings),
      // Returned here too: saving credentials is exactly the moment `configured`
      // flips true, and the UI reads it straight off this reply.
      ...(await presentStatus()),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * "Do these credentials work?" — answered on demand.
 *
 * Deliberately gated on `permitted` (the .env ceiling) but NOT on the `shipments`
 * capability. An admin testing credentials before switching Shiprocket on is the normal
 * case, and refusing to test until it is already on would make this useless for setup.
 *
 * Always 200 with an outcome. A failed CHECK is not a failed REQUEST — returning 502
 * here would make the browser treat a successful diagnosis as an error.
 */
export const TestShiprocketConnection = async (req, res) => {
  try {
    const capabilities = await getShippingCapabilities();
    if (!capabilities.permitted) {
      return res.status(200).json({
        success: true,
        ok: false,
        reason: "not_permitted",
        message:
          "Shiprocket is disabled for this environment (SHIPROCKET_ENABLED). Credentials cannot be tested until a developer enables it.",
      });
    }

    const result = await verifyShiprocketConnection();
    const messages = {
      authenticated: "Connected. These credentials work.",
      not_configured: "No email/password saved yet — enter them and save before testing.",
      rejected: "Shiprocket rejected these credentials.",
      unreachable: "Shiprocket could not be reached.",
      no_token: "Shiprocket accepted the login but returned no token.",
    };
    return res.status(200).json({
      success: true,
      ok: result.ok,
      reason: result.reason,
      message: messages[result.reason] || "Could not verify the connection.",
      // The API's own wording, which is the part that tells an admin whether it is a
      // wrong password or an outage. Never contains the credentials themselves.
      detail: result.detail || "",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * The pickup locations actually registered on this Shiprocket account.
 *
 * The point is to replace a free-text field that must match one of these EXACTLY. Same
 * gating rationale as the connection test: needed during setup, so it does not require
 * the shipments capability to already be on.
 */
export const GetPickupLocations = async (req, res) => {
  try {
    const capabilities = await getShippingCapabilities();
    if (!capabilities.permitted) {
      return res
        .status(200)
        .json({ success: true, ok: false, reason: "not_permitted", locations: [] });
    }

    // forceRefresh: the admin clicked "Load from Shiprocket", which usually means they
    // just registered a location there. A cached list would show them the old one.
    const result = await listPickupLocations({ forceRefresh: true });
    return res.status(200).json({
      success: true,
      ok: result.ok,
      reason: result.reason || "",
      detail: result.detail || "",
      locations: result.locations,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
