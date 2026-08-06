import { isAuthSecurityEnabled, isRateLimitEnabled } from "../config/features.config.js";
import { incrementRateLimit } from "../utils/redis-rate-limit.service.js";

const buckets = new Map();

// Memory buckets are only swept when the map grows past this size, so a long
// running process with many distinct client keys does not leak indefinitely.
const MEMORY_BUCKET_SWEEP_THRESHOLD = 5000;

const getClientKey = (req) =>
  req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

const sweepExpiredMemoryBuckets = (now) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

const incrementMemoryBucket = ({ key, windowMs }) => {
  const now = Date.now();

  if (buckets.size > MEMORY_BUCKET_SWEEP_THRESHOLD) sweepExpiredMemoryBuckets(now);

  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return bucket;
};

/**
 * Builds a rate limit middleware.
 *
 * Uses Redis when `RATE_LIMIT_STORE=redis` and falls back to an in-process
 * bucket, so a Redis outage degrades to per-instance limiting instead of
 * dropping the limit entirely.
 *
 * @param {object} options
 * @param {string} options.name Bucket namespace, keeps unrelated routes from sharing a counter.
 * @param {number} options.windowMs Window length in milliseconds.
 * @param {number} options.max Requests allowed per window.
 * @param {string} [options.message] Response message on limit.
 * @param {boolean} [options.perPath] Count each path separately within the namespace.
 * @param {() => boolean} [options.isEnabled] Override the default enablement check.
 */
export const createRateLimit = ({
  name,
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
  perPath = false,
  isEnabled = isRateLimitEnabled,
}) => {
  return async (req, res, next) => {
    if (!isEnabled()) return next();

    const scope = perPath ? `${name}:${req.path}` : name;
    const key = `${scope}:${getClientKey(req)}`;
    const bucket =
      (await incrementRateLimit({ key, windowMs }).catch(() => null)) ||
      incrementMemoryBucket({ key, windowMs });

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)));
      return res.status(429).json({
        success: false,
        message,
      });
    }

    return next();
  };
};

const MINUTE = 60 * 1000;

/**
 * Credential endpoints: login, signup, password reset, OTP/2FA.
 * Stays on whenever either the rate limit or the auth security toggle is on, so
 * existing deployments that only set `AUTH_SECURITY_ENABLED` keep their limits.
 */
export const authRateLimit = createRateLimit({
  name: "auth",
  windowMs: 15 * MINUTE,
  max: 30,
  message: "Too many attempts. Please try again later.",
  perPath: true,
  isEnabled: () => isRateLimitEnabled() || isAuthSecurityEnabled(),
});

/** Write endpoints that create user content and are cheap to abuse. */
export const contentWriteRateLimit = createRateLimit({
  name: "content-write",
  windowMs: 10 * MINUTE,
  max: 20,
  message: "Too many submissions. Please slow down and try again shortly.",
});

/** Read endpoints that hit the database on every keystroke. */
export const searchRateLimit = createRateLimit({
  name: "search",
  windowMs: MINUTE,
  max: 120,
  message: "Too many search requests. Please slow down.",
});

/** Coupon validation, guarding against brute-force code discovery. */
export const couponRateLimit = createRateLimit({
  name: "coupon",
  windowMs: 10 * MINUTE,
  max: 25,
  message: "Too many coupon attempts. Please try again later.",
});

/** Payment intent creation and verification. */
export const paymentRateLimit = createRateLimit({
  name: "payment",
  windowMs: 10 * MINUTE,
  max: 40,
  message: "Too many payment attempts. Please try again in a few minutes.",
});
