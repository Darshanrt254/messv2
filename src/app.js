import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import env from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import ownerCustomerRoutes from "./routes/ownerCustomerRoutes.js";
import ownerAttendanceRoutes from "./routes/ownerAttendanceRoutes.js";
import ownerMealTokenRoutes from "./routes/ownerMealTokenRoutes.js";
import ownerMessageRoutes from "./routes/ownerMessageRoutes.js";
import ownerAutomationRoutes from "./routes/ownerAutomationRoutes.js";
import ownerAnalyticsRoutes from "./routes/ownerAnalyticsRoutes.js";
import ownerExportRoutes from "./routes/ownerExportRoutes.js";
import testRoutes from "./routes/testRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorMiddleware.js";

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration (strictly configured origin, no wildcard with credentials)
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body and cookie parsing middleware
app.use(express.json());
app.use(cookieParser());

// Base API health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "swayamsiddha-backend",
    phase: 9,
    timestamp: new Date().toISOString(),
  });
});

// Mount modular API routers
app.use("/api/auth", authRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/owner/customers", ownerCustomerRoutes);
app.use("/api/owner/attendance", ownerAttendanceRoutes);
app.use("/api/owner/meal-tokens", ownerMealTokenRoutes);
app.use("/api/owner/messages", ownerMessageRoutes);
app.use("/api/owner/automation", ownerAutomationRoutes);
app.use("/api/owner/analytics", ownerAnalyticsRoutes);
app.use("/api/owner/exports", ownerExportRoutes);
app.use("/api/test", testRoutes);

// Catch-all 404 handler
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

export default app;
