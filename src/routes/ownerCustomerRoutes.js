import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as ownerCustomerController from "../controllers/ownerCustomerController.js";

const router = Router();

// All routes here strictly require authentication and OWNER role
router.use(requireAuth, requireRole("OWNER"));

router.get("/", ownerCustomerController.list);
router.post("/", ownerCustomerController.create);
router.get("/:customerId", ownerCustomerController.getDetail);
router.patch("/:customerId", ownerCustomerController.update);

export default router;
