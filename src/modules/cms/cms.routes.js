import express from "express";
import { GetCmsBlocks } from "./cms.controller.js";

const router = express.Router();

router.get("/blocks", GetCmsBlocks);

export default router;

