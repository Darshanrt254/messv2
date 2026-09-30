import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import {
  setMockTime,
  resetMockTime,
  parseBusinessDate,
  getBusinessDate,
} from "../src/utils/businessTime.js";

describe("Phase 10: Customer Attendance History API Tests", () => {
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let mealTokensStore = [];

  const CUSTOMER_PASSWORD = "test_customer_password";
  const OWNER_PASSWORD = "test_owner_password";

  let customerCookie = null;
  let ownerCookie = null;

  const customerUserId = "cust-user-hist";
  const ownerUserId = "owner-user-hist";
  const profileId = "cust-prof-hist";

  before(async () => {
    const custHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);

    usersStore = [
      {
        id: customerUserId,
        loginIdentifier: "9876543210",
        role: "CUSTOMER",
        passwordHash: custHash,
      },
      {
        id: ownerUserId,
        loginIdentifier: "owner@swayamsiddha.local",
        role: "OWNER",
        passwordHash: ownerHash,
      },
    ];

    customerProfilesStore = [
      {
        id: profileId,
        userId: customerUserId,
        name: "Rahul Sharma",
        phone: "9876543210",
        remainingTiffins: 20,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];

    // Seed sample attendances across September 2026
    const wedDate = parseBusinessDate("2026-09-30");
    const sunDate = parseBusinessDate("2026-10-04");

    attendancesStore = [
      {
        id: "att-hist-1",
        customerId: profileId,
        date: wedDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "COLLEGE",
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T04:00:00.000Z"),
        mealToken: {
          id: "tok-hist-1",
          token: "30-09-LU-C-001",
          createdAt: new Date("2026-09-30T04:05:00.000Z"),
        },
      },
      {
        id: "att-hist-2",
        customerId: profileId,
        date: wedDate,
        mealType: "DINNER",
        status: "PRESENT",
        location: "RESTAURANT",
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T13:00:00.000Z"),
        mealToken: {
          id: "tok-hist-2",
          token: "30-09-DN-R-001",
          createdAt: new Date("2026-09-30T13:05:00.000Z"),
        },
      },
      {
        id: "att-hist-3",
        customerId: profileId,
        date: sunDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
        source: "CUSTOMER",
        createdAt: new Date("2026-10-04T05:00:00.000Z"),
        mealToken: null,
      },
    ];

    // Prisma Mocks
    prisma.user.findUnique = async ({ where }) => {
      if (where.loginIdentifier) return usersStore.find((u) => u.loginIdentifier === where.loginIdentifier) || null;
      if (where.id) return usersStore.find((u) => u.id === where.id) || null;
      return null;
    };

    prisma.session.create = async ({ data }) => {
      const session = { id: `sess-${Date.now()}-${Math.random()}`, ...data };
      sessionsStore.push(session);
      return session;
    };

    prisma.session.findUnique = async ({ where, include }) => {
      let session = null;
      if (where.id) session = sessionsStore.find((s) => s.id === where.id);
      if (where.token) session = sessionsStore.find((s) => s.token === where.token);
      if (!session) return null;
      if (new Date() > new Date(session.expiresAt)) return null;
      const res = { ...session };
      if (include?.user) {
        res.user = usersStore.find((u) => u.id === session.userId) || null;
      }
      return res;
    };

    prisma.session.delete = async ({ where }) => {
      const idx = sessionsStore.findIndex((s) => s.id === where.id);
      if (idx !== -1) sessionsStore.splice(idx, 1);
      return { count: 1 };
    };

    prisma.customerProfile.findUnique = async ({ where }) => {
      if (where.userId) {
        return customerProfilesStore.find((c) => c.userId === where.userId) || null;
      }
      if (where.id) {
        return customerProfilesStore.find((c) => c.id === where.id) || null;
      }
      return null;
    };

    prisma.attendance.findMany = async ({ where, include } = {}) => {
      let list = [...attendancesStore];
      if (where?.customerId) {
        list = list.filter((a) => a.customerId === where.customerId);
      }
      if (where?.date?.gte && where?.date?.lte) {
        const startStr = new Date(where.date.gte).toISOString().slice(0, 10);
        const endStr = new Date(where.date.lte).toISOString().slice(0, 10);
        list = list.filter((a) => {
          const d = new Date(a.date).toISOString().slice(0, 10);
          return d >= startStr && d <= endStr;
        });
      }
      return list;
    };

    // Log in customer
    const custRes = await request(app).post("/api/auth/login").send({
      loginIdentifier: "9876543210",
      password: CUSTOMER_PASSWORD,
    });
    customerCookie = custRes.headers["set-cookie"]?.[0]?.split(";")[0];

    // Log in owner
    const ownerRes = await request(app).post("/api/auth/login").send({
      loginIdentifier: "owner@swayamsiddha.local",
      password: OWNER_PASSWORD,
    });
    ownerCookie = ownerRes.headers["set-cookie"]?.[0]?.split(";")[0];
  });

  afterEach(() => {
    resetMockTime();
  });

  test("1. Unauthenticated request to GET /api/customer/attendance/history returns 401", async () => {
    const res = await request(app).get("/api/customer/attendance/history");
    assert.equal(res.status, 401);
  });

  test("2. Owner attempting to access customer attendance history returns 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/customer/attendance/history")
      .set("Cookie", ownerCookie);
    assert.equal(res.status, 403);
  });

  test("3. Customer can fetch attendance history for an inclusive date range (200 OK)", async () => {
    const res = await request(app)
      .get("/api/customer/attendance/history?from=2026-09-30&to=2026-09-30")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.dateRange.from, "2026-09-30");
    assert.equal(res.body.dateRange.to, "2026-09-30");
    assert.equal(res.body.days.length, 1);

    const day = res.body.days[0];
    assert.equal(day.date, "2026-09-30");
    assert.equal(day.dayOfWeek, "WEDNESDAY");
    assert.equal(day.lunch.status, "PRESENT");
    assert.equal(day.lunch.location, "COLLEGE");
    assert.equal(day.lunch.mealToken.token, "30-09-LU-C-001");
    assert.equal(day.dinner.status, "PRESENT");
    assert.equal(day.dinner.location, "RESTAURANT");
    assert.equal(day.dinner.serviceAvailable, true);
    assert.equal(day.dinner.mealToken.token, "30-09-DN-R-001");
  });

  test("4. Missing attendance records return UNMARKED (never fabricated as ABSENT)", async () => {
    // 2026-09-29 has no records
    const res = await request(app)
      .get("/api/customer/attendance/history?from=2026-09-29&to=2026-09-29")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 1);
    const day = res.body.days[0];
    assert.equal(day.lunch.status, "UNMARKED");
    assert.equal(day.dinner.status, "UNMARKED");
  });

  test("5. Sunday dinner has serviceAvailable = false", async () => {
    // 2026-10-04 is a Sunday
    const res = await request(app)
      .get("/api/customer/attendance/history?from=2026-10-04&to=2026-10-04")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    const day = res.body.days[0];
    assert.equal(day.dinner.serviceAvailable, false);
    assert.equal(day.dinner.status, null);
  });

  test("6. Invalid dates and impossible dates return 400 Bad Request", async () => {
    const res1 = await request(app)
      .get("/api/customer/attendance/history?from=invalid")
      .set("Cookie", customerCookie);
    assert.equal(res1.status, 400);

    const res2 = await request(app)
      .get("/api/customer/attendance/history?from=2026-02-31")
      .set("Cookie", customerCookie);
    assert.equal(res2.status, 400);

    const res3 = await request(app)
      .get("/api/customer/attendance/history?from=2026-10-05&to=2026-10-01")
      .set("Cookie", customerCookie);
    assert.equal(res3.status, 400);
  });
});
