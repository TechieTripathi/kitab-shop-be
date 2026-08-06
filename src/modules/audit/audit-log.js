import AuditLog from "./AuditLog.model.js";

export const createAuditLog = async ({
  admin,
  action,
  module,
  targetId,
  targetName = "",
  description,
  req,
}) => {
  try {
    if (!action || !module || !description) return null;

    return await AuditLog.create({
      admin,
      action,
      module,
      targetId,
      targetName,
      description,
      ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || "",
      userAgent: req?.headers?.["user-agent"] || "",
    });
  } catch (error) {
    console.error("Audit log creation failed:", error.message);
    return null;
  }
};
