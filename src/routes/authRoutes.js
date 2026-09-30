import { Router } from "express";
import * as authController from "../controllers/authController.js";
import requireAuth from "../middleware/authMiddleware.js";

const router = Router();

// Public authentication route
router.post("/login", authController.login);

// Protected session routes
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
