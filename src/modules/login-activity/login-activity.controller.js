import mongoose from "mongoose";
import LoginActivity from "./LoginActivity.model.js";
import UserModel from "../../model/User.model.js";

let UAParser;
let geoip;

try {
  const parserModule = await import("ua-parser-js");
  UAParser = parserModule.UAParser || parserModule.default;
} catch {
  // The fallback below keeps activity tracking available before optional packages install.
}

try {
  geoip = (await import("geoip-lite")).default;
} catch {
  // Location remains empty when the GeoIP database is unavailable.
}

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || req.socket?.remoteAddress || req.ip || "")
        .split(",")[0]
        .trim();

  if (rawIp === "::1") return "127.0.0.1";
  return rawIp.replace(/^::ffff:/, "") || "Unknown";
};

const fallbackDeviceInfo = (userAgent = "") => {
  const browser =
    userAgent.match(/Edg\/([\d.]+)/)?.[0]?.replace("/", " ") ||
    userAgent.match(/Chrome\/([\d.]+)/)?.[0]?.replace("/", " ") ||
    userAgent.match(/Firefox\/([\d.]+)/)?.[0]?.replace("/", " ") ||
    userAgent.match(/Version\/([\d.]+).*Safari/)?.[1]?.replace(/^/, "Safari ") ||
    "Unknown";
  const operatingSystem = /Windows NT/i.test(userAgent)
    ? "Windows"
    : /Android/i.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(userAgent)
        ? "iOS"
        : /Mac OS X/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Unknown";
  const device = /iPad|Tablet/i.test(userAgent)
    ? "Tablet"
    : /Mobile|Android|iPhone|iPod/i.test(userAgent)
      ? "Mobile"
      : "Desktop";

  return { browser, operatingSystem, device };
};

const parseDevice = (userAgent) => {
  if (!UAParser) return fallbackDeviceInfo(userAgent);

  const parsed = new UAParser(userAgent).getResult();
  return {
    browser: parsed.browser.name || "Unknown",
    operatingSystem: parsed.os.name || "Unknown",
    device: parsed.device.type || "Desktop",
  };
};

export const CreateLoginActivity = async (req, userId) => {
  try {
    const userAgent = req.headers["user-agent"] || "";
    const deviceInfo = parseDevice(userAgent);
    const ipAddress = normalizeIp(req);
    const geo = geoip && ipAddress !== "127.0.0.1" ? geoip.lookup(ipAddress) : null;

    return await LoginActivity.create({
      userId,
      ipAddress,
      ...deviceInfo,
      location: {
        country: geo?.country || "",
        region: geo?.region || "",
        city: geo?.city || "",
        latitude: geo?.ll?.[0] ?? null,
        longitude: geo?.ll?.[1] ?? null,
      },
    });
  } catch (error) {
    console.error("Login Activity Error:", error.message);
    return null;
  }
};

export const CloseLoginActivity = async (userId, activityId) => {
  if (!mongoose.Types.ObjectId.isValid(activityId)) return null;

  return LoginActivity.findOneAndUpdate(
    { _id: activityId, userId, isActive: true },
    { $set: { isActive: false, logoutAt: new Date() } },
    { new: true },
  );
};

export const GetLoginActivities = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "all");
    const filter = {};

    if (status === "active") filter.isActive = true;
    if (status === "ended") filter.isActive = false;

    if (req.query.from) {
      const from = new Date(req.query.from);
      if (!Number.isNaN(from.getTime())) filter.loginAt = { $gte: from };
    }

    if (req.query.to) {
      const to = new Date(req.query.to);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.loginAt = { ...(filter.loginAt || {}), $lte: to };
      }
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const matchingUsers = await UserModel.find({ email: regex }).distinct("_id");
      filter.$or = [
        { userId: { $in: matchingUsers } },
        { ipAddress: regex },
        { browser: regex },
        { operatingSystem: regex },
        { device: regex },
        { "location.country": regex },
        { "location.region": regex },
        { "location.city": regex },
      ];
    }

    const [activities, total] = await Promise.all([
      LoginActivity.find(filter)
        .populate("userId", "email roles")
        .sort({ loginAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      LoginActivity.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: activities,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
