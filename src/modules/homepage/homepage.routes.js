import express from "express";
import { GetHomepageSettings } from "./homepage.controller.js";

const router = express.Router();

router.get("/settings", GetHomepageSettings);

export default router;
