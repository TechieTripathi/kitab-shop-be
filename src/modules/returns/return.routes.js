import express from "express";
import {
  CreateReturnRequest,
  GetMyReturns,
  GetReturnById,
} from "./return.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";
import { orderActionRateLimit } from "../../middleware/rate-limit.middleware.js";

const router = express.Router();

router.post("/", orderActionRateLimit, TokenVerify, CreateReturnRequest);
router.get("/my", TokenVerify, GetMyReturns);
router.get("/:id", TokenVerify, GetReturnById);

export default router;
