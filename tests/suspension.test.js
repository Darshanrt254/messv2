import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { setMockTime, resetMockTime, parseBusinessDate, getBusinessDate } from "../src/utils/businessTime.js";

describe("Phase 6: Service & Payment Suspension Tests", () => {
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let pollsStore = [];
  let pollVotesStore = [];
  let mealTokensStore = [];
  let mealCountersStore = [];
  let tiffinTransactionsStore = [];
  let serviceSuspensionsStore = [];
  let auditLogsStore = [];
  let messagesStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  const ownerUserId = "owner-uuid-p6";
  const customerUserId = "customer-uuid-p6";
  const customerProfileId = "cust-profile-uuid-p6";

  // Wednesday 2026-09-30 (08:30 IST = 03:00 UTC)
  const WEDNESDAY_0830_IST = "2026-09-30T03:00:00.000Z";
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
      {
        id: customerProfileId,
        userId: customerUserId,
        name: "Suspension Test Customer",
        phone: "+919876543200",
        remainingTiffins: 20,
        serviceStatus: "ACTIVE",
      },
    ];

    tiffinTransactionsStore = [
      {
        id: "tx-init-20",
        customerId: customerProfileId,
        quantity: 20,
        type: "INITIAL_BALANCE",
        reason: "Initial balance",
      },
    ];

    // Transaction mock with rollback support
    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        const snapProfiles = JSON.parse(JSON.stringify(customerProfilesStore));
        const snapSuspensions = JSON.parse(JSON.stringify(serviceSuspensionsStore));
        const snapAudits = JSON.parse(JSON.stringify(auditLogsStore));
        const snapTokens = JSON.parse(JSON.stringify(mealTokensStore));
        const snapCounters = JSON.parse(JSON.stringify(mealCountersStore));
        const snapTransactions = JSON.parse(JSON.stringify(tiffinTransactionsStore));

        try {
          return await callbackOrArray(prisma);
        } catch (err) {
          customerProfilesStore = snapProfiles;
          serviceSuspensionsStore = snapSuspensions;
          auditLogsStore = snapAudits;
          mealTokensStore = snapTokens;
          mealCountersStore = snapCounters;
          tiffinTransactionsStore = snapTransactions;
          throw err;
        }
      }
      return Promise.all(callbackOrArray);
    };

    prisma.user.findUnique = async ({ where }) => {
      if (where.loginIdentifier) {
        return usersStore.find((u) => u.loginIdentifier === where.loginIdentifier) || null;
      }
      if (where.id) {
        return usersStore.find((u) => u.id === where.id) || null;
      }
      return null;
    };

    prisma.customerProfile.findUnique = async ({ where, include }) => {
      let p = null;
      if (where.id) p = customerProfilesStore.find((item) => item.id === where.id) || null;
      if (where.userId) p = customerProfilesStore.find((item) => item.userId === where.userId) || null;
      if (!p) return null;
      const cloned = { ...p };
      if (include?.user) {
        cloned.user = usersStore.find((u) => u.id === cloned.userId) || null;
      }
      return cloned;
    };

    prisma.customerProfile.update = async ({ where, data }) => {
      const idx = customerProfilesStore.findIndex((p) => p.id === where.id);
      if (idx === -1) throw new Error("Customer profile not found");
      const current = customerProfilesStore[idx];
      let newRemaining = current.remainingTiffins;
      if (data.remainingTiffins?.increment !== undefined) {
        newRemaining += data.remainingTiffins.increment;
      } else if (typeof data.remainingTiffins === "number") {
        newRemaining = data.remainingTiffins;
      }

      Object.assign(current, data, { remainingTiffins: newRemaining });
      return current;
    };

    prisma.customerProfile.updateMany = async ({ where, data }) => {
      const match = customerProfilesStore.find((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.remainingTiffins?.gt !== undefined && !(p.remainingTiffins > where.remainingTiffins.gt)) {
          return false;
        }
        return true;
      });
      if (!match) return { count: 0 };
      if (data.remainingTiffins?.decrement !== undefined) {
        match.remainingTiffins -= data.remainingTiffins.decrement;
      }
      return { count: 1 };
    };

    // ServiceSuspension mocks
    prisma.serviceSuspension = {
      create: async ({ data }) => {
        const item = {
          id: `susp-${Date.now()}-${Math.random()}`,
          ...data,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        serviceSuspensionsStore.push(item);
        return item;
      },
      findMany: async ({ where }) => {
        return serviceSuspensionsStore.filter((s) => s.customerId === where.customerId);
      },
      findFirst: async ({ where }) => {
        return (
          serviceSuspensionsStore.find((s) => {
            if (where.id?.not && s.id === where.id.not) return false;
            if (where.customerId && s.customerId !== where.customerId) return false;
            if (where.startDate?.lte && new Date(s.startDate) > new Date(where.startDate.lte)) return false;
            if (where.endDate?.gte && new Date(s.endDate) < new Date(where.endDate.gte)) return false;
            return true;
          }) || null
        );
      },
      update: async ({ where, data }) => {
        const idx = serviceSuspensionsStore.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error("Suspension not found");
        serviceSuspensionsStore[idx] = { ...serviceSuspensionsStore[idx], ...data };
        return serviceSuspensionsStore[idx];
      },
      delete: async ({ where }) => {
        const idx = serviceSuspensionsStore.findIndex((s) => s.id === where.id);
        if (idx !== -1) {
          const removed = serviceSuspensionsStore[idx];
          serviceSuspensionsStore.splice(idx, 1);
          return removed;
        }
        return null;
      },
    };

    // Attendance mocks
    prisma.attendance.findUnique = async ({ where, include }) => {
      let rec = null;
      if (where.id) {
        rec = attendancesStore.find((a) => a.id === where.id) || null;
      } else if (where.customerId_date_mealType) {
        const target = new Date(where.customerId_date_mealType.date).toISOString().slice(0, 10);
        rec =
          attendancesStore.find(
            (a) =>
              a.customerId === where.customerId_date_mealType.customerId &&
              new Date(a.date).toISOString().slice(0, 10) === target &&
              a.mealType === where.customerId_date_mealType.mealType
          ) || null;
      }
      if (!rec) return null;
      const cloned = { ...rec };
      if (include?.customer) {
        cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
      }
      if (include?.mealToken) {
        cloned.mealToken = mealTokensStore.find((m) => m.attendanceId === cloned.id) || null;
      }
      return cloned;
    };

    prisma.attendance.findMany = async ({ where, include }) => {
      let results = [...attendancesStore];
      if (where?.customerId) results = results.filter((a) => a.customerId === where.customerId);
      if (where?.date) {
        const target = new Date(where.date).toISOString().slice(0, 10);
        results = results.filter((a) => new Date(a.date).toISOString().slice(0, 10) === target);
      }
      return results.map((rec) => {
        const cloned = { ...rec };
        if (include?.customer) {
          cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
        }
        if (include?.mealToken) {
          cloned.mealToken = mealTokensStore.find((m) => m.attendanceId === cloned.id) || null;
        }
        return cloned;
      });
    };

    prisma.attendance.create = async ({ data }) => {
      const item = {
        id: `att-${Date.now()}-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      attendancesStore.push(item);
      return item;
    };

    prisma.attendance.update = async ({ where, data }) => {
      const idx = attendancesStore.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error("Attendance not found");
      attendancesStore[idx] = { ...attendancesStore[idx], ...data };
      return attendancesStore[idx];
    };

    // Poll & Vote mocks
    prisma.poll = {
      upsert: async ({ where, update, create }) => {
        const targetDate = new Date(where.date_mealType.date).toISOString().split("T")[0];
        const existingIndex = pollsStore.findIndex(
          (p) =>
            new Date(p.date).toISOString().split("T")[0] === targetDate &&
            p.mealType === where.date_mealType.mealType
        );
        if (existingIndex !== -1) {
          pollsStore[existingIndex] = { ...pollsStore[existingIndex], ...update };
          return pollsStore[existingIndex];
        }
        const newPoll = {
          id: `poll-${Date.now()}-${Math.random()}`,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pollsStore.push(newPoll);
        return newPoll;
      },
      findUnique: async ({ where }) => {
        if (where.id) return pollsStore.find((p) => p.id === where.id) || null;
        if (where.date_mealType) {
          const target = new Date(where.date_mealType.date).toISOString().split("T")[0];
          return (
            pollsStore.find(
              (p) =>
                new Date(p.date).toISOString().split("T")[0] === target &&
                p.mealType === where.date_mealType.mealType
            ) || null
          );
        }
        return null;
      },
    };

    prisma.pollVote = {
      findUnique: async ({ where }) => {
        return (
          pollVotesStore.find(
            (v) =>
              v.pollId === where.pollId_customerId.pollId &&
              v.customerId === where.pollId_customerId.customerId
          ) || null
        );
      },
      create: async ({ data }) => {
        const item = { id: `vote-${Date.now()}`, ...data, votedAt: new Date() };
        pollVotesStore.push(item);
        return item;
      },
    };

    // MealToken, MealCounter, TiffinTransaction, AuditLog, Message mocks
    prisma.mealToken = {
      findUnique: async ({ where }) => {
        if (where.attendanceId) return mealTokensStore.find((m) => m.attendanceId === where.attendanceId) || null;
        if (where.token) return mealTokensStore.find((m) => m.token === where.token) || null;
        return null;
      },
      create: async ({ data }) => {
        const item = { id: `token-${Date.now()}`, ...data, createdAt: new Date() };
        mealTokensStore.push(item);
        return item;
      },
    };

    prisma.mealCounter = {
      upsert: async ({ where, update, create }) => {
        const { date, mealType, location } = where.date_mealType_location;
        const target = new Date(date).toISOString().slice(0, 10);
        let counter = mealCountersStore.find(
          (c) =>
            new Date(c.date).toISOString().slice(0, 10) === target &&
            c.mealType === mealType &&
            c.location === location
        );
        if (counter) {
          if (update.nextSerial?.increment) counter.nextSerial += update.nextSerial.increment;
          return { ...counter };
        }
        const created = { id: `counter-${Date.now()}`, ...create };
        mealCountersStore.push(created);
        return { ...created };
      },
    };

    prisma.tiffinTransaction = {
      create: async ({ data }) => {
        const item = { id: `tx-${Date.now()}`, ...data, createdAt: new Date() };
        tiffinTransactionsStore.push(item);
        return item;
      },
      findMany: async ({ where }) => {
        if (where?.customerId) return tiffinTransactionsStore.filter((t) => t.customerId === where.customerId);
        return tiffinTransactionsStore;
      },
    };

    prisma.auditLog = {
      create: async ({ data }) => {
        const item = { id: `audit-${Date.now()}`, ...data, createdAt: new Date() };
        auditLogsStore.push(item);
        return item;
      },
    };

    prisma.message = {
      create: async ({ data }) => {
        const item = {
          id: `msg-${Date.now()}-${Math.random()}`,
          ...data,
          createdAt: new Date(),
        };
        messagesStore.push(item);
        return item;
      },
      findMany: async ({ where }) => {
        let results = [...messagesStore];
        if (where?.customerId) results = results.filter((m) => m.customerId === where.customerId);
        return results;
      },
      findUnique: async ({ where }) => {
        return messagesStore.find((m) => m.id === where.id) || null;
      },
      update: async ({ where, data }) => {
        const idx = messagesStore.findIndex((m) => m.id === where.id);
        if (idx === -1) throw new Error("Message not found");
        messagesStore[idx] = { ...messagesStore[idx], ...data };
        return messagesStore[idx];
      },
    };

    prisma.session = {
      create: async ({ data }) => {
        const item = { id: `sess-${Date.now()}`, ...data };
        sessionsStore.push(item);
        return item;
      },
      findUnique: async ({ where, include }) => {
        const session = sessionsStore.find((s) => s.token === where.token);
        if (!session) return null;
        if (include?.user) {
          const user = usersStore.find((u) => u.id === session.userId);
          return { ...session, user };
        }
        return session;
      },
    };

    // Login OWNER and CUSTOMER
    const ownerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "owner@swayamsiddha.local", password: OWNER_PASSWORD });
    ownerCookie = ownerRes.headers["set-cookie"]?.[0];

    const customerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    customerCookie = customerRes.headers["set-cookie"]?.[0];
  });

  beforeEach(() => {
    setMockTime(WEDNESDAY_0830_IST);
  });

  afterEach(() => {
    resetMockTime();
  });

  // 1. Owner can suspend customer
  test("Test 1: Owner can suspend customer for a date range", async () => {
    const res = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/suspension`)
      .set("Cookie", ownerCookie)
      .send({
        startDate: "2026-09-30",
        endDate: "2026-10-05",
        reason: "Traveling out of town",
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.suspension);
    assert.equal(res.body.suspension.customerId, customerProfileId);
  });

  // 2. Customer cannot create suspension (403)
  test("Test 2: Customer cannot create suspension (403 Forbidden)", async () => {
    const res = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/suspension`)
      .set("Cookie", customerCookie)
      .send({
        startDate: "2026-09-30",
        endDate: "2026-10-05",
      });

    assert.equal(res.status, 403);
  });

  // 3. Active suspension blocks customer attendance
  test("Test 3: Active suspension blocks customer attendance marking", async () => {
    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Service is suspended for this date/);
  });

  // 4. Active suspension blocks lunch poll
  test("Test 4: Active suspension sets poll eligibility to false with SERVICE_SUSPENDED reason", async () => {
    const res = await request(app)
      .get("/api/customer/poll/today")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.eligible, false);
    assert.equal(res.body.locked, true);
    assert.equal(res.body.reason, "SERVICE_SUSPENDED");
  });

  // 5. Active suspension blocks lunch poll voting
  test("Test 5: Active suspension blocks voting in lunch poll", async () => {
    const res = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Service is suspended/);
  });

  // 6. Active suspension blocks token generation
  test("Test 6: Active suspension blocks token generation", async () => {
    const suspendedAttId = "att-suspended-meal";
    attendancesStore.push({
      id: suspendedAttId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${suspendedAttId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Customer service is suspended/);
  });

  // 7. Suspension does not deduct tiffins or create token
  test("Test 7: Suspension does not deduct tiffins and does not create meal token", () => {
    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    assert.equal(cust.remainingTiffins, 20, "Tiffin balance must not be modified by suspension");
    assert.equal(mealTokensStore.length, 0, "No meal token should be created");
  });

  // 8. Suspension creates AuditLog
  test("Test 8: Suspension action creates OWNER_SERVICE_SUSPENDED audit log", () => {
    const audit = auditLogsStore.find((a) => a.action === "OWNER_SERVICE_SUSPENDED");
    assert.ok(audit);
    assert.equal(audit.entityType, "ServiceSuspension");
  });

  // 9. Owner can list suspensions
  test("Test 9: Owner can list customer suspensions", async () => {
    const res = await request(app)
      .get(`/api/owner/customers/${customerProfileId}/suspension`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.suspensions));
    assert.ok(res.body.suspensions.length >= 1);
  });

  // 10. Owner can unsuspend early
  test("Test 10: Owner can unsuspend customer early", async () => {
    const active = serviceSuspensionsStore[0];
    const res = await request(app)
      .patch(`/api/owner/customers/${customerProfileId}/suspension/${active.id}/unsuspend`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.match(res.body.message, /unsuspended successfully/);

    // Verify AuditLog
    const unsuspendAudit = auditLogsStore.find((a) => a.action === "OWNER_SERVICE_UNSUSPENDED");
    assert.ok(unsuspendAudit);
  });

  // 11. After unsuspension, customer can mark attendance again
  test("Test 11: After unsuspension, customer can mark attendance normally", async () => {
    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
  });

  // 12. Payment suspension at balance 0
  test("Test 12: Customer with balance 0 is payment suspended and blocked from attendance and poll", async () => {
    // Set customer balance to 0
    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    cust.remainingTiffins = 0;
    cust.serviceStatus = "PAYMENT_SUSPENDED";

    // 12a. Customer can still login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    assert.equal(loginRes.status, 200);

    // 12b. Customer can view profile
    const profileRes = await request(app)
      .get("/api/customer/me")
      .set("Cookie", customerCookie);
    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.body.customer.remainingTiffins, 0);

    // 12c. Attendance blocked at balance 0 (409 Conflict)
    const nextDay = parseBusinessDate("2026-10-01");
    setMockTime("2026-10-01T04:30:00.000Z");

    const attRes = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });
    assert.equal(attRes.status, 409);
    assert.match(attRes.body.error, /payment-suspended/);

    // 12d. Poll blocked at balance 0 (409 Conflict)
    const pollRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "RESTAURANT" });
    assert.equal(pollRes.status, 409);
    assert.match(pollRes.body.error, /payment-suspended/);

    // Restore balance for subsequent tests
    cust.remainingTiffins = 20;
    cust.serviceStatus = "ACTIVE";
  });
});
