import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as ownerAnalyticsController from "../controllers/ownerAnalyticsController.js";

const router = Router();

// Strictly require authentication and OWNER role for all analytics endpoints
router.use(requireAuth, requireRole("OWNER"));

router.get("/overview", ownerAnalyticsController.getOverview);
router.get("/attendance", ownerAnalyticsController.getAttendance);
router.get("/locations", ownerAnalyticsController.getLocations);
router.get("/meals", ownerAnalyticsController.getMeals);
router.get("/tiffins", ownerAnalyticsController.getTiffins);
router.get("/balances", ownerAnalyticsController.getBalances);
router.get("/customer-status", ownerAnalyticsController.getCustomerStatus);
router.get("/suspensions", ownerAnalyticsController.getSuspensions);
router.get("/polls", ownerAnalyticsController.getPolls);
router.get("/messages", ownerAnalyticsController.getMessages);
router.get("/tokens", ownerAnalyticsController.getTokens);
router.get("/daily", ownerAnalyticsController.getDaily);

export default router;
