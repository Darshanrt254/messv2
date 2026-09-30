import { getSessionTokenFromRequest } from "../utils/cookie.js";
import { validateSession } from "../services/authService.js";
import ApiError from "../utils/apiError.js";

/**
 * Authentication middleware that verifies the HTTP-only session cookie.
 * Attaches the authenticated user to `req.user` or returns 401 Unauthorized.
 */
export async function requireAuth(req, res, next) {
  try {
    const sessionToken = getSessionTokenFromRequest(req);

    if (!sessionToken) {
      return next(ApiError.unauthorized("Authentication required. Please log in."));
    }

    const user = await validateSession(sessionToken);

    if (!user) {
      return next(ApiError.unauthorized("Invalid or expired session. Please log in again."));
    }

    // Attach verified user and session token to request
    req.user = user;
    req.sessionToken = sessionToken;

    next();
  } catch (error) {
    next(error);
  }
}

export default requireAuth;
