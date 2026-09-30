import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as customerController from "../controllers/customerController.js";

const router = Router();

// Customer self-service profile endpoint
router.get("/me", requireAuth, requireRole("CUSTOMER"), customerController.getMe);

export default router;
