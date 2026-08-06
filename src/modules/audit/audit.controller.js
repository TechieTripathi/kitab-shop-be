import AuditLog from "./AuditLog.model.js";
import { getPrimaryRole } from "../../config/admin-permissions.config.js";

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const buildFilter = (query = {}) => {
  const { action, module, search, from, to } = query;
  const filter = {};

  if (action && action !== "all") filter.action = action;
  if (module && module !== "all") filter.module = module;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) toDate.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = toDate;
    }
  }
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { action: regex },
      { module: regex },
      { targetName: regex },
      { description: regex },
    ];
  }

  return filter;
};

export const GetAuditLogs = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const logs = await AuditLog.find(filter)
      .populate("admin", "email roles")
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 500, 2000));

    return res.status(200).json({
      success: true,
      total: logs.length,
      data: logs,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const ExportAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find(buildFilter(req.query))
      .populate("admin", "email roles")
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    const rows = [
      ["createdAt", "adminEmail", "adminRole", "action", "module", "targetName", "description", "ipAddress"],
      ...logs.map((log) => [
        log.createdAt?.toISOString?.() || "",
        log.admin?.email || "",
        log.admin ? getPrimaryRole(log.admin) : "",
        log.action,
        log.module,
        log.targetName,
        log.description,
        log.ipAddress,
      ]),
    ];

    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="audit-logs.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
