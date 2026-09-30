import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as ownerMealTokenController from "../controllers/ownerMealTokenController.js";

const router = Router();

// Strictly require OWNER authentication and authorization
router.use(requireAuth, requireRole("OWNER"));

router.post("/:attendanceId", ownerMealTokenController.createToken);

export default router;
