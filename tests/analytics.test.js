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
  getNow,
} from "../src/utils/businessTime.js";

describe("Phase 8: Owner Analytics & Operational Summary API Tests", () => {
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let pollsStore = [];
  let pollVotesStore = [];
  let mealTokensStore = [];
  let tiffinTransactionsStore = [];
  let serviceSuspensionsStore = [];
  let messagesStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;

  const ownerUserId = "owner-uuid-p8";
  const customerUserId = "cust-user-p8";

  // Controlled Customer Profiles
  const custA_id = "cust-a-p8"; // Normal active (25 tiffins)
  const custB_id = "cust-b-p8"; // Low balance (10 tiffins)
  const custC_id = "cust-c-p8"; // Very low balance (5 tiffins)
  const custD_id = "cust-d-p8"; // Service Suspended (20 tiffins)
  const custE_id = "cust-e-p8"; // Payment Suspended (0 tiffins)

  // Wednesday 2026-09-30 (12:00 IST = 06:30 UTC)
  const WEDNESDAY_1200_IST = "2026-09-30T06:30:00.000Z";
  const WEDNESDAY_DATE = parseBusinessDate("2026-09-30");

  before(async () => {
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    usersStore = [
      {
        id: ownerUserId,
        loginIdentifier: "owner@swayamsiddha.local",
        role: "OWNER",
        passwordHash: ownerHash,
      },
      {
        id: customerUserId,
        loginIdentifier: "customer@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
      },
    ];

    customerProfilesStore = [
      { id: custA_id, userId: "user-a", name: "Alice", remainingTiffins: 25, serviceStatus: "ACTIVE" },
      { id: custB_id, userId: "user-b", name: "Bob", remainingTiffins: 10, serviceStatus: "ACTIVE" },
      { id: custC_id, userId: "user-c", name: "Charlie", remainingTiffins: 5, serviceStatus: "ACTIVE" },
      { id: custD_id, userId: "user-d", name: "Diana", remainingTiffins: 20, serviceStatus: "ACTIVE" },
      { id: custE_id, userId: "user-e", name: "Evan", remainingTiffins: 0, serviceStatus: "PAYMENT_SUSPENDED" },
    ];

    // Controlled Attendance Records on 2026-09-30
    attendancesStore = [
      // Alice: Lunch Restaurant (PRESENT), Dinner Restaurant (PRESENT)
      { id: "att-a-lu", customerId: custA_id, date: WEDNESDAY_DATE, mealType: "LUNCH", status: "PRESENT", location: "RESTAURANT" },
      { id: "att-a-dn", customerId: custA_id, date: WEDNESDAY_DATE, mealType: "DINNER", status: "PRESENT", location: "RESTAURANT" },
      // Bob: Lunch College (PRESENT), Dinner Restaurant (PRESENT)
      { id: "att-b-lu", customerId: custB_id, date: WEDNESDAY_DATE, mealType: "LUNCH", status: "PRESENT", location: "COLLEGE" },
      { id: "att-b-dn", customerId: custB_id, date: WEDNESDAY_DATE, mealType: "DINNER", status: "PRESENT", location: "RESTAURANT" },
      // Charlie: Lunch Absent, Dinner Absent
      { id: "att-c-lu", customerId: custC_id, date: WEDNESDAY_DATE, mealType: "LUNCH", status: "ABSENT", location: null },
      { id: "att-c-dn", customerId: custC_id, date: WEDNESDAY_DATE, mealType: "DINNER", status: "ABSENT", location: null },
      // Diana: Service Suspended -> Absent (SUSPENSION)
      { id: "att-d-lu", customerId: custD_id, date: WEDNESDAY_DATE, mealType: "LUNCH", status: "ABSENT", location: null, source: "SUSPENSION" },
      { id: "att-d-dn", customerId: custD_id, date: WEDNESDAY_DATE, mealType: "DINNER", status: "ABSENT", location: null, source: "SUSPENSION" },
      // Evan: Unmarked
      { id: "att-e-lu", customerId: custE_id, date: WEDNESDAY_DATE, mealType: "LUNCH", status: "UNMARKED", location: null },
      { id: "att-e-dn", customerId: custE_id, date: WEDNESDAY_DATE, mealType: "DINNER", status: "UNMARKED", location: null },
    ];

    // Controlled MealToken Records (Authoritative for meals/tokens)
    mealTokensStore = [
      { id: "tok-1", attendanceId: "att-a-lu", token: "30-09-LU-R-001", date: WEDNESDAY_DATE, mealType: "LUNCH", location: "RESTAURANT", serialNumber: 1 },
      { id: "tok-2", attendanceId: "att-a-dn", token: "30-09-DN-R-001", date: WEDNESDAY_DATE, mealType: "DINNER", location: "RESTAURANT", serialNumber: 1 },
      { id: "tok-3", attendanceId: "att-b-dn", token: "30-09-DN-R-002", date: WEDNESDAY_DATE, mealType: "DINNER", location: "RESTAURANT", serialNumber: 2 },
      // Bob's Lunch token is missing to verify difference between Attendance and consumed MealToken!
    ];

    // Controlled Tiffin Ledger Transactions (IST 2026-09-30 falls within 2026-09-29T18:30:00Z to 2026-09-30T18:30:00Z)
    const txTime = new Date("2026-09-30T07:00:00.000Z");
    tiffinTransactionsStore = [
      { id: "tx-1", customerId: custA_id, type: "INITIAL_BALANCE", quantity: 2800, createdAt: txTime },
      { id: "tx-2", customerId: custB_id, type: "CASH_RECHARGE", quantity: 1500, createdAt: txTime },
      { id: "tx-3", customerId: custA_id, type: "MEAL_TOKEN", quantity: -1, createdAt: txTime },
      { id: "tx-4", customerId: custA_id, type: "MEAL_TOKEN", quantity: -1, createdAt: txTime },
      { id: "tx-5", customerId: custB_id, type: "MEAL_TOKEN", quantity: -1, createdAt: txTime },
      { id: "tx-6", customerId: custC_id, type: "ADJUSTMENT", quantity: 50, createdAt: txTime },
    ];

    // Service Suspensions (Diana suspended 2026-09-28 through 2026-10-02)
    serviceSuspensionsStore = [
      {
        id: "susp-1",
        customerId: custD_id,
        startDate: parseBusinessDate("2026-09-28"),
        endDate: parseBusinessDate("2026-10-02"),
        reason: "Medical leave",
      },
    ];

    // Poll & Votes
    const pollId = "poll-2026-09-30";
    pollsStore = [
      {
        id: pollId,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        status: "CLOSED",
      },
    ];

    pollVotesStore = [
      { pollId, customerId: custB_id, option: "COLLEGE", location: "COLLEGE", poll: pollsStore[0] },
      { pollId, customerId: custA_id, option: "RESTAURANT", location: "RESTAURANT", poll: pollsStore[0] },
      { pollId, customerId: custD_id, option: "RESTAURANT", location: "RESTAURANT", poll: pollsStore[0] },
    ];

    // Messages
    messagesStore = [
      { id: "msg-1", customerId: custA_id, status: "UNREAD", createdAt: txTime },
      { id: "msg-2", customerId: custB_id, status: "READ", createdAt: txTime },
      { id: "msg-3", customerId: custB_id, status: "READ", createdAt: txTime },
      { id: "msg-4", customerId: custC_id, status: "RESOLVED", createdAt: txTime },
      { id: "msg-5", customerId: custC_id, status: "RESOLVED", createdAt: txTime },
      { id: "msg-6", customerId: custD_id, status: "RESOLVED", createdAt: txTime },
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

    prisma.customerProfile = {
      count: async ({ where } = {}) => {
        let list = [...customerProfilesStore];
        if (where?.remainingTiffins?.lte !== undefined) {
          list = list.filter((p) => p.remainingTiffins <= where.remainingTiffins.lte);
        }
        return list.length;
      },
      findMany: async () => [...customerProfilesStore],
    };

    prisma.attendance = {
      findMany: async ({ where } = {}) => {
        let list = [...attendancesStore];
        if (where?.date) {
          const target = new Date(where.date).toISOString().slice(0, 10);
          list = list.filter((a) => new Date(a.date).toISOString().slice(0, 10) === target);
        }
        return list;
      },
      groupBy: async ({ by, where, _count }) => {
        let list = [...attendancesStore];
        if (where?.date?.gte && where?.date?.lte) {
          const start = new Date(where.date.gte).toISOString().slice(0, 10);
          const end = new Date(where.date.lte).toISOString().slice(0, 10);
          list = list.filter((a) => {
            const d = new Date(a.date).toISOString().slice(0, 10);
            return d >= start && d <= end;
          });
        }
        if (where?.status) list = list.filter((a) => a.status === where.status);
        if (where?.location?.not === null) list = list.filter((a) => a.location !== null);

        // Group by requested fields
        const map = new Map();
        for (const item of list) {
          const key = by.map((k) => (k === "date" ? new Date(item.date).toISOString() : item[k])).join("___");
          if (!map.has(key)) {
            const entry = {};
            for (const k of by) entry[k] = item[k];
            entry._count = 0;
            map.set(key, entry);
          }
          map.get(key)._count++;
        }
        return Array.from(map.values());
      },
    };

    prisma.mealToken = {
      findMany: async ({ where } = {}) => {
        let list = [...mealTokensStore];
        if (where?.date) {
          const target = new Date(where.date).toISOString().slice(0, 10);
          list = list.filter((m) => new Date(m.date).toISOString().slice(0, 10) === target);
        }
        return list;
      },
      groupBy: async ({ by, where, _count }) => {
        let list = [...mealTokensStore];
        if (where?.date?.gte && where?.date?.lte) {
          const start = new Date(where.date.gte).toISOString().slice(0, 10);
          const end = new Date(where.date.lte).toISOString().slice(0, 10);
          list = list.filter((m) => {
            const d = new Date(m.date).toISOString().slice(0, 10);
            return d >= start && d <= end;
          });
        }
        const map = new Map();
        for (const item of list) {
          const key = by.map((k) => (k === "date" ? new Date(item.date).toISOString() : item[k])).join("___");
          if (!map.has(key)) {
            const entry = {};
            for (const k of by) entry[k] = item[k];
            entry._count = 0;
            map.set(key, entry);
          }
          map.get(key)._count++;
        }
        return Array.from(map.values());
      },
    };

    prisma.tiffinTransaction = {
      groupBy: async ({ by, where, _sum, _count }) => {
        let list = [...tiffinTransactionsStore];
        if (where?.createdAt?.gte && where?.createdAt?.lt) {
          const start = new Date(where.createdAt.gte);
          const end = new Date(where.createdAt.lt);
          list = list.filter((t) => t.createdAt >= start && t.createdAt < end);
        }
        const map = new Map();
        for (const item of list) {
          const key = by.map((k) => item[k]).join("___");
          if (!map.has(key)) {
            const entry = {};
            for (const k of by) entry[k] = item[k];
            entry._count = 0;
            entry._sum = { quantity: 0 };
            map.set(key, entry);
          }
          const rec = map.get(key);
          rec._count++;
          rec._sum.quantity += item.quantity;
        }
        return Array.from(map.values());
      },
    };

    prisma.serviceSuspension = {
      findMany: async ({ where } = {}) => {
        let list = [...serviceSuspensionsStore];
        if (where?.startDate?.lte && where?.endDate?.gte) {
          const target = new Date(where.startDate.lte).toISOString().slice(0, 10);
          list = list.filter((s) => {
            const sStart = new Date(s.startDate).toISOString().slice(0, 10);
            const sEnd = new Date(s.endDate).toISOString().slice(0, 10);
            return target >= sStart && target <= sEnd;
          });
        }
        return list;
      },
    };

    prisma.poll = {
      count: async () => pollsStore.length,
      findUnique: async ({ where }) => {
        const target = new Date(where.date_mealType.date).toISOString().slice(0, 10);
        const poll = pollsStore.find(
          (p) => new Date(p.date).toISOString().slice(0, 10) === target && p.mealType === where.date_mealType.mealType
        );
        if (!poll) return null;
        return {
          ...poll,
          votes: pollVotesStore.filter((v) => v.pollId === poll.id),
        };
      },
    };

    prisma.pollVote = {
      groupBy: async ({ by }) => {
        const groupField = by?.[0] || "option";
        const map = new Map();
        for (const item of pollVotesStore) {
          const key = item[groupField] || item.option || item.location;
          if (!map.has(key)) {
            map.set(key, { [groupField]: key, option: key, location: key, _count: 0 });
          }
          map.get(key)._count++;
        }
        return Array.from(map.values());
      },
    };

    prisma.message = {
      groupBy: async ({ by, where }) => {
        let list = [...messagesStore];
        if (where?.createdAt?.gte && where?.createdAt?.lt) {
          const start = new Date(where.createdAt.gte);
          const end = new Date(where.createdAt.lt);
          list = list.filter((m) => m.createdAt >= start && m.createdAt < end);
        }
        const map = new Map();
        for (const item of list) {
          const key = item.status;
          if (!map.has(key)) {
            map.set(key, { status: key, _count: 0 });
          }
          map.get(key)._count++;
        }
        return Array.from(map.values());
      },
    };

    // Owner Login
    const ownerLogin = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "owner@swayamsiddha.local", password: OWNER_PASSWORD });
    ownerCookie = ownerLogin.headers["set-cookie"][0].split(";")[0];

    // Customer Login
    const customerLogin = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    customerCookie = customerLogin.headers["set-cookie"][0].split(";")[0];
  });

  afterEach(() => {
    resetMockTime();
  });

  // ==================================================
  // 1. AUTHORIZATION TESTS
  // ==================================================
  test("Auth Test: Customer receives 403 Forbidden on all 12 analytics endpoints", async () => {
    const endpoints = [
      "/api/owner/analytics/overview",
      "/api/owner/analytics/attendance",
      "/api/owner/analytics/locations",
      "/api/owner/analytics/meals",
      "/api/owner/analytics/tiffins",
      "/api/owner/analytics/balances",
      "/api/owner/analytics/customer-status",
      "/api/owner/analytics/suspensions",
      "/api/owner/analytics/polls",
      "/api/owner/analytics/messages",
      "/api/owner/analytics/tokens",
      "/api/owner/analytics/daily",
    ];

    for (const ep of endpoints) {
      const res = await request(app).get(ep).set("Cookie", customerCookie);
      assert.equal(res.status, 403, `Endpoint ${ep} should reject customer with 403`);
    }
  });

  test("Auth Test: Unauthenticated requests receive 401 Unauthorized", async () => {
    const res = await request(app).get("/api/owner/analytics/overview");
    assert.equal(res.status, 401);
  });

  // ==================================================
  // 2. DATE RANGE VALIDATION TESTS
  // ==================================================
  test("Date Validation: Rejects malformed dates and impossible dates (400 Bad Request)", async () => {
    const res1 = await request(app)
      .get("/api/owner/analytics/overview?from=invalid-date")
      .set("Cookie", ownerCookie);
    assert.equal(res1.status, 400);

    const res2 = await request(app)
      .get("/api/owner/analytics/overview?from=2026-02-31")
      .set("Cookie", ownerCookie);
    assert.equal(res2.status, 400);

    const res3 = await request(app)
      .get("/api/owner/analytics/overview?from=2026-10-05&to=2026-10-01")
      .set("Cookie", ownerCookie);
    assert.equal(res3.status, 400);
    assert.match(res3.body.error, /must be on or before/);
  });

  // ==================================================
  // 3. OVERVIEW ANALYTICS ENDPOINT
  // ==================================================
  test("Overview Analytics: Correctly aggregates metrics across all operational subsystems", async () => {
    setMockTime(WEDNESDAY_1200_IST);

    const res = await request(app)
      .get("/api/owner/analytics/overview?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);

    // Customers: Total 5, 1 service suspended (Diana), 1 payment suspended (Evan), 3 active (Alice, Bob, Charlie)
    assert.equal(res.body.customers.total, 5);
    assert.equal(res.body.customers.active, 3);
    assert.equal(res.body.customers.serviceSuspended, 1);
    assert.equal(res.body.customers.paymentSuspended, 1);

    // Attendance:
    // Lunch: 2 Present (Alice, Bob), 2 Absent (Charlie, Diana), 1 Unmarked (Evan)
    assert.equal(res.body.attendance.lunch.present, 2);
    assert.equal(res.body.attendance.lunch.absent, 2);
    assert.equal(res.body.attendance.lunch.unmarked, 1);
    // Dinner: 2 Present (Alice, Bob), 2 Absent (Charlie, Diana), 1 Unmarked (Evan)
    assert.equal(res.body.attendance.dinner.present, 2);
    assert.equal(res.body.attendance.dinner.absent, 2);
    assert.equal(res.body.attendance.dinner.unmarked, 1);

    // Meals (Tokenized): Lunch = 1 (Alice), Dinner = 2 (Alice, Bob), Total = 3
    assert.equal(res.body.meals.lunch, 1);
    assert.equal(res.body.meals.dinner, 2);
    assert.equal(res.body.meals.total, 3);

    // Locations:
    // Lunch: 1 Restaurant (Alice), 1 College (Bob)
    assert.equal(res.body.locations.lunch.restaurant, 1);
    assert.equal(res.body.locations.lunch.college, 1);
    // Dinner: 2 Restaurant (Alice, Bob), 0 College
    assert.equal(res.body.locations.dinner.restaurant, 2);
    assert.equal(res.body.locations.dinner.college, 0);

    // Tiffins: consumed = 3, recharged = 1500
    assert.equal(res.body.tiffins.consumed, 3);
    assert.equal(res.body.tiffins.recharged, 1500);

    // Polls: votes = 3, college = 1, restaurant = 2
    assert.equal(res.body.polls.votes, 3);
    assert.equal(res.body.polls.college, 1);
    assert.equal(res.body.polls.restaurant, 2);

    // Messages: 1 unread, 2 read, 3 resolved
    assert.equal(res.body.messages.unread, 1);
    assert.equal(res.body.messages.read, 2);
    assert.equal(res.body.messages.resolved, 3);
  });

  // ==================================================
  // 4. ATTENDANCE ANALYTICS ENDPOINT
  // ==================================================
  test("Attendance Analytics: Returns daily attendance breakdown and totals", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/attendance?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.days.length, 1);
    assert.equal(res.body.days[0].date, "2026-09-30");
    assert.equal(res.body.days[0].lunch.present, 2);
    assert.equal(res.body.days[0].lunch.absent, 2);
    assert.equal(res.body.days[0].lunch.unmarked, 1);

    assert.equal(res.body.totals.lunch.present, 2);
    assert.equal(res.body.totals.dinner.present, 2);
  });

  // ==================================================
  // 5. LOCATION ANALYTICS ENDPOINT
  // ==================================================
  test("Location Analytics: Authoritative distribution from Attendance.location", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/locations?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.lunch.restaurant, 1);
    assert.equal(res.body.lunch.college, 1);
    assert.equal(res.body.lunch.total, 2);

    assert.equal(res.body.dinner.restaurant, 2);
    assert.equal(res.body.dinner.college, 0);
    assert.equal(res.body.dinner.total, 2);

    assert.equal(res.body.total, 4);
  });

  // ==================================================
  // 6. MEAL CONSUMPTION ANALYTICS ENDPOINT
  // ==================================================
  test("Meal Consumption: Counts only actual tokenized meals from MealToken", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/meals?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    // Bob is PRESENT for lunch but has NO token -> Lunch consumed is 1, not 2!
    assert.equal(res.body.lunch, 1);
    assert.equal(res.body.dinner, 2);
    assert.equal(res.body.total, 3);
  });

  // ==================================================
  // 7. TIFFIN LEDGER ANALYTICS ENDPOINT
  // ==================================================
  test("Tiffin Ledger Analytics: Authoritative quantities, signed aggregates, and counts", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/tiffins?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.initialBalance, 2800);
    assert.equal(res.body.cashRecharge, 1500);
    assert.equal(res.body.mealConsumption, 3);
    assert.equal(res.body.adjustments, 50);

    // netChange = 2800 + 1500 - 3 + 50 = 4347
    assert.equal(res.body.netChange, 4347);
    assert.equal(res.body.counts.mealToken, 3);
    assert.equal(res.body.counts.cashRecharge, 1);
    assert.equal(res.body.counts.total, 6);
  });

  // ==================================================
  // 8. BALANCE ANALYTICS ENDPOINT
  // ==================================================
  test("Balance Analytics: Accurate low-balance and payment-pending thresholds", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/balances")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    // Balances: 25, 10, 5, 20, 0 -> Total = 60
    assert.equal(res.body.totalCustomers, 5);
    assert.equal(res.body.totalRemainingTiffins, 60);
    assert.equal(res.body.averageRemainingTiffins, 12);

    // Low Balance (<= 10): Bob (10), Charlie (5), Evan (0) -> 3
    assert.equal(res.body.lowBalance.count, 3);

    // Very Low Balance (<= 5): Charlie (5), Evan (0) -> 2
    assert.equal(res.body.veryLowBalance.count, 2);

    // Payment Pending (=== 0): Evan (0) -> 1
    assert.equal(res.body.paymentPending.count, 1);
  });

  // ==================================================
  // 9. CUSTOMER STATUS SNAPSHOT ENDPOINT
  // ==================================================
  test("Customer Status Analytics: Snapshot on evaluation date", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/customer-status?date=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.evaluationDate, "2026-09-30");
    assert.equal(res.body.totalCustomers, 5);
    assert.equal(res.body.active, 3);
    assert.equal(res.body.serviceSuspended, 1);
    assert.equal(res.body.paymentSuspended, 1);
    assert.equal(res.body.dualSuspended, 0);
  });

  // ==================================================
  // 10. SUSPENSION ANALYTICS ENDPOINT
  // ==================================================
  test("Suspension Analytics: Distinct customers and active vs completed counts", async () => {
    setMockTime(WEDNESDAY_1200_IST);

    const res = await request(app)
      .get("/api/owner/analytics/suspensions?from=2026-09-28&to=2026-10-05")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalSuspensionRecords, 1);
    assert.equal(res.body.distinctCustomersAffected, 1);
    // Suspension ends 2026-10-02, which is >= today (2026-09-30), so active = 1
    assert.equal(res.body.activeSuspensions, 1);
    assert.equal(res.body.completedSuspensions, 0);
  });

  // ==================================================
  // 11. POLL ANALYTICS ENDPOINT
  // ==================================================
  test("Poll Analytics: Weekday lunch poll totals and location options", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/polls?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalPolls, 1);
    assert.equal(res.body.totalVotes, 3);
    assert.equal(res.body.college, 1);
    assert.equal(res.body.restaurant, 2);
  });

  // ==================================================
  // 12. MESSAGE ANALYTICS ENDPOINT
  // ==================================================
  test("Message Analytics: Status counts without modifying messages", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/messages?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalMessages, 6);
    assert.equal(res.body.unread, 1);
    assert.equal(res.body.read, 2);
    assert.equal(res.body.resolved, 3);
  });

  // ==================================================
  // 13. TOKEN ANALYTICS ENDPOINT
  // ==================================================
  test("Token Analytics: Accurate meal and location tokens from MealToken table", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/tokens?from=2026-09-30&to=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalTokens, 3);
    assert.equal(res.body.lunchTokens, 1);
    assert.equal(res.body.dinnerTokens, 2);
    assert.equal(res.body.restaurantTokens, 3);
    assert.equal(res.body.collegeTokens, 0);
    assert.equal(res.body.days.length, 1);
  });

  // ==================================================
  // 14. DAILY OPERATIONAL SUMMARY ENDPOINT
  // ==================================================
  test("Daily Operational Summary: Wednesday operational snapshot", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/daily?date=2026-09-30")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.date, "2026-09-30");
    assert.equal(res.body.dayOfWeek, "WEDNESDAY");

    assert.equal(res.body.lunch.available, true);
    assert.equal(res.body.lunch.present, 2);
    assert.equal(res.body.lunch.restaurant, 1);
    assert.equal(res.body.lunch.college, 1);
    assert.equal(res.body.lunch.tokens, 1);

    assert.equal(res.body.dinner.available, true);
    assert.equal(res.body.dinner.present, 2);
    assert.equal(res.body.dinner.tokens, 2);

    assert.equal(res.body.tiffinsConsumed, 3);
    assert.equal(res.body.poll.available, true);
    assert.equal(res.body.poll.votes, 3);
  });

  test("Daily Operational Summary: Sunday dinner unavailable", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/daily?date=2026-10-04")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.date, "2026-10-04");
    assert.equal(res.body.dayOfWeek, "SUNDAY");
    assert.equal(res.body.dinner.available, false);
    assert.equal(res.body.dinner.tokens, 0);
    assert.equal(res.body.poll.available, false);
  });

  test("Daily Operational Summary: Saturday lunch poll unavailable", async () => {
    const res = await request(app)
      .get("/api/owner/analytics/daily?date=2026-10-03")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.date, "2026-10-03");
    assert.equal(res.body.dayOfWeek, "SATURDAY");
    assert.equal(res.body.lunch.available, true);
    assert.equal(res.body.dinner.available, true);
    assert.equal(res.body.poll.available, false);
  });
});
