const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

export const isRefreshCookieEnabled = () =>
  TRUE_VALUES.has(String(process.env.REFRESH_TOKEN_COOKIE_ENABLED ?? "true").toLowerCase());

const cookieName = () => process.env.REFRESH_TOKEN_COOKIE_NAME || "kitab_refresh_token";

const isProduction = () => process.env.NODE_ENV === "production";

const cookieOptions = () => [
  "HttpOnly",
  "Path=/",
  `Max-Age=${7 * 24 * 60 * 60}`,
  `SameSite=${isProduction() ? "None" : "Lax"}`,
  ...(isProduction() ? ["Secure"] : []),
];

const serializeCookie = (name, value, options) =>
  `${name}=${encodeURIComponent(value)}; ${options.join("; ")}`;

export const setRefreshTokenCookie = (res, refreshToken) => {
  if (!isRefreshCookieEnabled() || !refreshToken) return;
  res.setHeader(
    "Set-Cookie",
    serializeCookie(cookieName(), refreshToken, cookieOptions()),
  );
};

export const clearRefreshTokenCookie = (res) => {
  if (!isRefreshCookieEnabled()) return;
  res.setHeader(
    "Set-Cookie",
    serializeCookie(cookieName(), "", [
      "HttpOnly",
      "Path=/",
      "Max-Age=0",
      `SameSite=${isProduction() ? "None" : "Lax"}`,
      ...(isProduction() ? ["Secure"] : []),
    ]),
  );
};

export const getRefreshTokenFromCookie = (req) => {
  const header = req.headers.cookie || "";
  if (!header) return "";

  const target = `${cookieName()}=`;
  const cookie = header
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(target));

  return cookie ? decodeURIComponent(cookie.slice(target.length)) : "";
};
