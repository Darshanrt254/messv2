import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as customerController from "../controllers/customerController.js";
import * as attendanceController from "../controllers/attendanceController.js";
import * as pollController from "../controllers/pollController.js";

const router = Router();

// Apply customer authentication and authorization to all customer endpoints
router.use(requireAuth, requireRole("CUSTOMER"));

// Customer self-service profile endpoint
router.get("/me", customerController.getMe);

// Customer daily meal & attendance endpoints
router.get("/meals/today", attendanceController.getTodayMealState);
router.post("/attendance", attendanceController.markAttendance);

// Customer lunch poll endpoints
router.get("/poll/today", pollController.getTodayPoll);
router.post("/poll/vote", pollController.vote);

export default router;
