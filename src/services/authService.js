import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import env from "../config/env.js";
import ApiError from "../utils/apiError.js";

/**
 * Strips sensitive fields (like passwordHash) and formats safe user representation.
 */
export function formatSafeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    loginIdentifier: user.loginIdentifier,
    role: user.role,
    createdAt: user.createdAt,
    customerProfile: user.customerProfile
      ? {
          id: user.customerProfile.id,
          name: user.customerProfile.name,
          phone: user.customerProfile.phone,
          profilePictureUrl: user.customerProfile.profilePictureUrl,
          remainingTiffins: user.customerProfile.remainingTiffins,
          serviceStatus: user.customerProfile.serviceStatus,
          joinDate: user.customerProfile.joinDate,
        }
      : null,
  };
}

/**
 * Validates credentials, creates a server-side session, and returns safe user data with session token.
 */
export async function login({ loginIdentifier, password }) {
  if (!loginIdentifier || typeof loginIdentifier !== "string" || !loginIdentifier.trim()) {
    throw ApiError.badRequest("Login identifier is required");
  }

  if (!password || typeof password !== "string") {
    throw ApiError.badRequest("Password is required");
  }

  const normalizedIdentifier = loginIdentifier.trim().toLowerCase();

  // Find user by unique login identifier
  const user = await prisma.user.findUnique({
    where: { loginIdentifier: normalizedIdentifier },
    include: {
      customerProfile: true,
    },
  });

  if (!user) {
    // Generic error to avoid account enumeration
    throw ApiError.unauthorized("Invalid login identifier or password");
  }

  // Verify password hash
  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    // Generic error to avoid leaking credential correctness
    throw ApiError.unauthorized("Invalid login identifier or password");
  }

  // Generate cryptographically secure session token
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  // Persist session in PostgreSQL
  await prisma.session.create({
    data: {
      userId: user.id,
      token: sessionToken,
      expiresAt,
    },
  });

  return {
    user: formatSafeUser(user),
    sessionToken,
  };
}

/**
 * Validates an active session token and returns the safe user if session is valid and unexpired.
 */
export async function validateSession(sessionToken) {
  if (!sessionToken || typeof sessionToken !== "string") {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: {
      user: {
        include: {
          customerProfile: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  // Check if session has expired
  if (session.expiresAt <= new Date()) {
    // Clean up expired session asynchronously
    prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return formatSafeUser(session.user);
}

/**
 * Invalidates and removes the session from the server-side store.
 */
export async function logout(sessionToken) {
  if (!sessionToken || typeof sessionToken !== "string") {
    return;
  }

  await prisma.session.deleteMany({
    where: { token: sessionToken },
  });
}
