import env from "../config/env.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
  maxAge: env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  path: "/",
};

/**
 * Attaches the session token to the HTTP response as a secure, HTTP-only cookie.
 */
export function setSessionCookie(res, token) {
  res.cookie(env.SESSION_COOKIE_NAME, token, COOKIE_OPTIONS);
}

/**
 * Clears the session cookie from the client.
 */
export function clearSessionCookie(res) {
  res.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
    path: "/",
  });
}

/**
 * Extracts the session token from the incoming request cookies.
 */
export function getSessionTokenFromRequest(req) {
  if (!req.cookies) {
    return null;
  }
  return req.cookies[env.SESSION_COOKIE_NAME] || null;
}
