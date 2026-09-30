import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import {
  finalizeLunch,
  finalizeDinner,
  getSchedulerInfo,
} from "../controllers/ownerAutomationController.js";

const router = Router();

// All automation endpoints are restricted to OWNER role
router.use(requireAuth, requireRole("OWNER"));

router.post("/finalize-lunch", finalizeLunch);
router.post("/finalize-dinner", finalizeDinner);
router.get("/status", getSchedulerInfo);

export default router;
