import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import env from "../src/config/env.js";

describe("Phase 2: Authentication & Role-Based Authorization Tests", () => {
  // In-memory test store mirroring PostgreSQL database
  let usersStore = [];
  let sessionsStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  before(async () => {
    // Generate bcrypt hashes for realistic development seed accounts
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    usersStore = [
      {
        id: "owner-uuid-1",
        loginIdentifier: "owner@swayamsiddha.local",
        role: "OWNER",
        passwordHash: ownerHash,
        createdAt: new Date(),
        customerProfile: null,
      },
      {
        id: "customer-uuid-2",
        loginIdentifier: "customer@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
        createdAt: new Date(),
        customerProfile: {
          id: "customer-profile-uuid-1",
          userId: "customer-uuid-2",
          name: "Dev Test Customer",
          phone: "+919876543210",
          profilePictureUrl: null,
          remainingTiffins: 55,
          serviceStatus: "ACTIVE",
          joinDate: new Date(),
        },
      },
    ];

    // Mock Prisma methods for isolated and deterministic verification
    prisma.user.findUnique = async ({ where }) => {
      if (where.loginIdentifier) {
        return usersStore.find((u) => u.loginIdentifier === where.loginIdentifier) || null;
      }
      if (where.id) {
        return usersStore.find((u) => u.id === where.id) || null;
      }
      return null;
    };

    prisma.session.create = async ({ data }) => {
      const newSession = {
        id: `sess-${Date.now()}-${Math.random()}`,
        userId: data.userId,
        token: data.token,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sessionsStore.push(newSession);
      return newSession;
    };

    prisma.session.findUnique = async ({ where }) => {
      const sess = sessionsStore.find((s) => s.token === where.token);
      if (!sess) return null;

      const user = usersStore.find((u) => u.id === sess.userId);
      return {
        ...sess,
        user,
      };
    };

    prisma.session.deleteMany = async ({ where }) => {
      if (where.token) {
        sessionsStore = sessionsStore.filter((s) => s.token !== where.token);
      }
      return { count: 1 };
    };

    prisma.session.delete = async ({ where }) => {
      if (where.id) {
        sessionsStore = sessionsStore.filter((s) => s.id !== where.id);
      }
      return {};
    };
  });

  beforeEach(() => {
    // Clear active sessions before each test
    sessionsStore = [];
  });

  // Test A - OWNER login
  test("Test A: POST /api/auth/login with OWNER credentials returns 200, sets HTTP-only cookie, and returns OWNER role", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "owner@swayamsiddha.local",
        password: OWNER_PASSWORD,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Login successful");
    assert.ok(res.body.user);
    assert.equal(res.body.user.role, "OWNER");
    assert.equal(res.body.user.loginIdentifier, "owner@swayamsiddha.local");
    assert.equal(res.body.user.passwordHash, undefined, "passwordHash must never be returned");

    // Verify Set-Cookie header
    const cookies = res.headers["set-cookie"];
    assert.ok(cookies, "Set-Cookie header must be present");
    const sessionCookie = cookies.find((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
    assert.ok(sessionCookie, "Session cookie must be present");
    assert.match(sessionCookie, /HttpOnly/i, "Cookie must be HttpOnly");
  });

  // Test B - CUSTOMER login
  test("Test B: POST /api/auth/login with CUSTOMER credentials returns 200, sets cookie, and returns CUSTOMER role", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "customer@swayamsiddha.local",
        password: CUSTOMER_PASSWORD,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "CUSTOMER");
    assert.equal(res.body.user.loginIdentifier, "customer@swayamsiddha.local");
    assert.ok(res.body.user.customerProfile);
    assert.equal(res.body.user.customerProfile.remainingTiffins, 55);
    assert.equal(res.body.user.passwordHash, undefined);

    const cookies = res.headers["set-cookie"];
    assert.ok(cookies);
    const sessionCookie = cookies.find((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/i);
  });

  // Test C - Invalid password / credentials
  test("Test C: POST /api/auth/login with incorrect password returns 401 with generic error message", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "owner@swayamsiddha.local",
        password: "wrong_password_attempt",
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, "Invalid login identifier or password");
    assert.equal(res.headers["set-cookie"], undefined, "Cookie must not be set on failed login");
  });

  // Test D - /me after login
  test("Test D: GET /api/auth/me with valid session cookie returns 200 and authenticated user identity", async () => {
    // First, login to get session cookie
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "owner@swayamsiddha.local",
        password: OWNER_PASSWORD,
      });

    const cookie = loginRes.headers["set-cookie"];

    // Next, call /me with the session cookie
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie);

    assert.equal(meRes.status, 200);
    assert.ok(meRes.body.user);
    assert.equal(meRes.body.user.loginIdentifier, "owner@swayamsiddha.local");
    assert.equal(meRes.body.user.role, "OWNER");
  });

  // Test E - /me without authentication
  test("Test E: GET /api/auth/me without authentication cookie returns 401 Unauthorized", async () => {
    const res = await request(app).get("/api/auth/me");

    assert.equal(res.status, 401);
    assert.match(res.body.error, /authentication required/i);
  });

  // Test F - Logout
  test("Test F: POST /api/auth/logout invalidates session, clears cookie, and subsequent /me returns 401", async () => {
    // 1. Login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "customer@swayamsiddha.local",
        password: CUSTOMER_PASSWORD,
      });

    const cookie = loginRes.headers["set-cookie"];

    // 2. Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.message, "Logged out successfully");

    // Verify cookie cleared
    const logoutCookies = logoutRes.headers["set-cookie"];
    assert.ok(logoutCookies);
    const clearedCookie = logoutCookies.find((c) => c.startsWith(`${env.SESSION_COOKIE_NAME}=`));
    assert.ok(clearedCookie);
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/i);

    // 3. Verify /me now fails with 401
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie);

    assert.equal(meRes.status, 401);
  });

  // Test G - Role protection
  test("Test G: Role protection on /api/test/owner allows OWNER (200), forbids CUSTOMER (403), rejects unauthenticated (401)", async () => {
    // 1. Unauthenticated request -> 401
    const unauthRes = await request(app).get("/api/test/owner");
    assert.equal(unauthRes.status, 401);

    // 2. Login as OWNER
    const ownerLoginRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "owner@swayamsiddha.local",
        password: OWNER_PASSWORD,
      });
    const ownerCookie = ownerLoginRes.headers["set-cookie"];

    // OWNER accessing /api/test/owner -> 200 OK
    const ownerAccessRes = await request(app)
      .get("/api/test/owner")
      .set("Cookie", ownerCookie);
    assert.equal(ownerAccessRes.status, 200);
    assert.equal(ownerAccessRes.body.user.role, "OWNER");

    // 3. Login as CUSTOMER
    const customerLoginRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "customer@swayamsiddha.local",
        password: CUSTOMER_PASSWORD,
      });
    const customerCookie = customerLoginRes.headers["set-cookie"];

    // CUSTOMER accessing /api/test/owner -> 403 Forbidden
    const customerAccessRes = await request(app)
      .get("/api/test/owner")
      .set("Cookie", customerCookie);
    assert.equal(customerAccessRes.status, 403);
    assert.match(customerAccessRes.body.error, /access denied/i);

    // CUSTOMER accessing /api/test/customer -> 200 OK
    const customerOwnRouteRes = await request(app)
      .get("/api/test/customer")
      .set("Cookie", customerCookie);
    assert.equal(customerOwnRouteRes.status, 200);
    assert.equal(customerOwnRouteRes.body.user.role, "CUSTOMER");
  });
});
