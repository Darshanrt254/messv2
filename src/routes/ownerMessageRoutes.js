import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import * as messageController from "../controllers/messageController.js";

const router = Router();

// Strictly require OWNER authentication and authorization
router.use(requireAuth, requireRole("OWNER"));

router.get("/", messageController.listOwnerMessages);
router.patch("/:messageId", messageController.updateOwnerMessage);

export default router;
