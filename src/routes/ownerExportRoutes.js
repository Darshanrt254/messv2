import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import requireRole from "../middleware/roleMiddleware.js";
import { downloadOperationalXlsx } from "../controllers/ownerExportController.js";

const router = Router();

// All export endpoints require authenticated OWNER role
router.use(requireAuth, requireRole("OWNER"));

/**
 * GET /api/owner/exports/xlsx
 */
router.get("/xlsx", downloadOperationalXlsx);

export default router;
