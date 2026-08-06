import { createClient } from "redis";

let clientPromise = null;

const getRedisClient = async () => {
  const url = process.env.REDIS_URL;
  if (!url || process.env.RATE_LIMIT_STORE !== "redis") return null;

  if (!clientPromise) {
    const client = createClient({ url });
    client.on("error", (error) => {
      console.error("Redis rate limit error:", error.message);
    });
    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
};

export const incrementRateLimit = async ({ key, windowMs }) => {
  const client = await getRedisClient();
  if (!client) return null;

  const redisKey = `rate-limit:${key}`;
  const count = await client.incr(redisKey);
  if (count === 1) {
    await client.pExpire(redisKey, windowMs);
  }
  const ttl = await client.pTTL(redisKey);

  return {
    count,
    resetAt: Date.now() + Math.max(ttl, 0),
  };
};
