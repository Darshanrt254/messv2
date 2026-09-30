import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as ownerCustomerController from "../controllers/ownerCustomerController.js";
import * as ownerSuspensionController from "../controllers/ownerSuspensionController.js";
import * as ownerRechargeController from "../controllers/ownerRechargeController.js";

const router = Router();

// All routes here strictly require authentication and OWNER role
router.use(requireAuth, requireRole("OWNER"));

router.get("/", ownerCustomerController.list);
router.post("/", ownerCustomerController.create);
router.get("/:customerId", ownerCustomerController.getDetail);
router.patch("/:customerId", ownerCustomerController.update);

// Service Suspension routes
router.post("/:customerId/suspension", ownerSuspensionController.create);
router.get("/:customerId/suspension", ownerSuspensionController.list);
router.patch("/:customerId/suspension/:suspensionId/unsuspend", ownerSuspensionController.unsuspend);

// Cash Recharge route
router.post("/:customerId/recharge", ownerRechargeController.recharge);

export default router;
