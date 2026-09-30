/**
 * ============================================================================
 * TEMPORARY TEST-ONLY AUTHORIZATION ROUTES
 * ============================================================================
 * Strictly intended for verifying Phase 2 authentication and role-based
 * authorization middleware (Test G). Do NOT treat as business functionality.
 * ============================================================================
 */

import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";

const router = Router();

// Test route strictly protected for OWNER role
router.get("/owner", requireAuth, requireRole("OWNER"), (req, res) => {
  res.status(200).json({
    message: "Authorized: OWNER access granted.",
    user: req.user,
  });
});

// Test route strictly protected for CUSTOMER role
router.get("/customer", requireAuth, requireRole("CUSTOMER"), (req, res) => {
  res.status(200).json({
    message: "Authorized: CUSTOMER access granted.",
    user: req.user,
  });
});

export default router;
