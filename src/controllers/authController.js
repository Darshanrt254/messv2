import * as authService from "../services/authService.js";
import { setSessionCookie, clearSessionCookie } from "../utils/cookie.js";

/**
 * Handles user login.
 * POST /api/auth/login
 */
export async function login(req, res, next) {
  try {
    const { loginIdentifier, password } = req.body || {};

    const { user, sessionToken } = await authService.login({
      loginIdentifier,
      password,
    });

    // Set HTTP-only secure cookie
    setSessionCookie(res, sessionToken);

    return res.status(200).json({
      message: "Login successful",
      user,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles user logout.
 * POST /api/auth/logout
 */
export async function logout(req, res, next) {
  try {
    const sessionToken = req.sessionToken;

    if (sessionToken) {
      await authService.logout(sessionToken);
    }

    // Always clear the cookie
    clearSessionCookie(res);

    return res.status(200).json({
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Retrieves the currently authenticated user's profile.
 * GET /api/auth/me
 */
export async function me(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}
