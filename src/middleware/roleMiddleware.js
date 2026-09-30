import ApiError from "../utils/apiError.js";

/**
 * Role-based authorization middleware factory.
 * Enforces that req.user has one of the required roles.
 *
 * @param  {...string} allowedRoles - Array of allowed role names (e.g. 'OWNER', 'CUSTOMER')
 * @returns {Function} Express middleware function
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized("Authentication required."));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Access denied. Role '${req.user.role}' is not authorized to access this resource.`
        )
      );
    }

    next();
  };
}

export default requireRole;
