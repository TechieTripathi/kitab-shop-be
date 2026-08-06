import express from "express";
import {
  CreatePolicy,
  DeletePolicy,
  GetAllPolicies,
  GetPolicyBySlug,
  UpdatePolicy,
} from "./policy.controller.js";
import { isAdmin } from "../../middleware/is-admin.middleware.js";
import { requirePermission } from "../../middleware/require-permission.middleware.js";
import { ADMIN_PERMISSIONS } from "../../config/admin-permissions.config.js";

const routes = express.Router();

routes.get("/all-policies", GetAllPolicies);

routes.post("/create", isAdmin, requirePermission(ADMIN_PERMISSIONS.POLICIES_MANAGE), CreatePolicy);
routes.put("/update/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.POLICIES_MANAGE), UpdatePolicy);
routes.delete("/delete/:id", isAdmin, requirePermission(ADMIN_PERMISSIONS.POLICIES_MANAGE), DeletePolicy);

routes.get("/:slug", GetPolicyBySlug);

export default routes;
