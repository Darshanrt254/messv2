import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as ownerAttendanceController from "../controllers/ownerAttendanceController.js";

const router = Router();

// Strictly require OWNER authentication and authorization
router.use(requireAuth, requireRole("OWNER"));

router.get("/", ownerAttendanceController.list);
router.patch("/:attendanceId", ownerAttendanceController.update);

export default router;
