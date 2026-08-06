import { createVerify } from "node:crypto";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

let googleCertCache = {
  expiresAt: 0,
  certs: {},
};

const normalizeEmail = (email = "") => String(email).trim().toLowerCase();

const base64UrlToBuffer = (value = "") =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const decodeJwtPart = (value = "") =>
  JSON.parse(base64UrlToBuffer(value).toString("utf8"));

const getGoogleCerts = async () => {
  if (
    googleCertCache.expiresAt > Date.now() &&
    Object.keys(googleCertCache.certs).length
  ) {
    return googleCertCache.certs;
  }

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error("Could not fetch Google public certificates");
  }

  const cacheControl = response.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 60 * 60 * 1000;
  const certs = await response.json();
  googleCertCache = {
    certs,
    expiresAt: Date.now() + maxAgeMs,
  };

  return certs;
};

export const verifyGoogleCredential = async (credential) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google login is not configured on the server");
  }

  const parts = String(credential || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Google credential");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid Google token header");
  }

  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error("Google certificate not found for this token");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const isValidSignature = verifier.verify(
    cert,
    base64UrlToBuffer(encodedSignature),
  );
  if (!isValidSignature) throw new Error("Invalid Google token signature");

  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error("Invalid Google token issuer");
  }
  if (payload.aud !== clientId) {
    throw new Error("Invalid Google token audience");
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) {
    throw new Error("Google token has expired");
  }
  if (payload.email_verified !== true) {
    throw new Error("Google account email is not verified");
  }

  return {
    email: normalizeEmail(payload.email),
    name: String(payload.name || "").trim(),
    firstName: String(payload.given_name || "").trim(),
    lastName: String(payload.family_name || "").trim(),
    avatar: String(payload.picture || "").trim(),
    googleId: String(payload.sub || "").trim(),
  };
};
