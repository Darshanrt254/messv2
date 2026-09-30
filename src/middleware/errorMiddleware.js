import env from "../config/env.js";
import ApiError from "../utils/apiError.js";

/**
 * 404 Not Found middleware for unmatched routes.
 */
export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Centralized error-handling middleware.
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (err.status ? err.status : 500);
  const message = err.message || "Internal server error";

  // Log 500 errors to console for diagnostics
  if (statusCode >= 500) {
    console.error(`[Server Error] ${req.method} ${req.originalUrl}:`, err);
  }

  const response = {
    error: message,
  };

  if (err.details) {
    response.details = err.details;
  }

  // Include stack trace only in development/test
  if (env.NODE_ENV !== "production" && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

export default errorHandler;
