import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { setMockTime, resetMockTime, parseBusinessDate } from "../src/utils/businessTime.js";

describe("Phase 6: Owner Cash Recharge & Integration Workflow Tests", () => {
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

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  const ownerUserId = "owner-uuid-recharge";
  const customerUserId = "customer-uuid-recharge";
  const customerProfileId = "cust-profile-uuid-recharge";

  const TEST_DATE = parseBusinessDate("2026-10-01"); // Thursday
  const TEST_0830_IST = "2026-10-01T03:00:00.000Z";

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
        name: "Recharge Test Customer",
        phone: "+919876543209",
        remainingTiffins: 1, // Start with exactly 1 tiffin for integration flow
        serviceStatus: "ACTIVE",
      },
    ];

    tiffinTransactionsStore = [
      {
        id: "tx-init-1",
        customerId: customerProfileId,
        quantity: 1,
        type: "INITIAL_BALANCE",
        reason: "Initial enrollment balance of 1",
      },
    ];

    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        const snapProfiles = JSON.parse(JSON.stringify(customerProfilesStore));
        const snapTransactions = JSON.parse(JSON.stringify(tiffinTransactionsStore));
        const snapAudits = JSON.parse(JSON.stringify(auditLogsStore));
        const snapTokens = JSON.parse(JSON.stringify(mealTokensStore));
        const snapCounters = JSON.parse(JSON.stringify(mealCountersStore));

        try {
          return await callbackOrArray(prisma);
        } catch (err) {
          customerProfilesStore = snapProfiles;
          tiffinTransactionsStore = snapTransactions;
          auditLogsStore = snapAudits;
          mealTokensStore = snapTokens;
          mealCountersStore = snapCounters;
          throw err;
        }
      }
      return Promise.all(callbackOrArray);
    };

    prisma.user.findUnique = async ({ where }) => {
      if (where.loginIdentifier) return usersStore.find((u) => u.loginIdentifier === where.loginIdentifier) || null;
      if (where.id) return usersStore.find((u) => u.id === where.id) || null;
      return null;
    };

    prisma.customerProfile.findUnique = async ({ where }) => {
      if (where.id) return customerProfilesStore.find((p) => p.id === where.id) || null;
      if (where.userId) return customerProfilesStore.find((p) => p.userId === where.userId) || null;
      return null;
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

    prisma.serviceSuspension = {
      findFirst: async () => null,
      findMany: async () => [],
    };

    prisma.tiffinTransaction = {
      create: async ({ data }) => {
        const item = { id: `tx-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
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

    prisma.attendance = {
      create: async ({ data }) => {
        const item = { id: `att-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        attendancesStore.push(item);
        return item;
      },
      findUnique: async ({ where, include }) => {
        let rec = null;
        if (where.id) rec = attendancesStore.find((a) => a.id === where.id) || null;
        else if (where.customerId_date_mealType) {
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
        if (include?.customer) cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
        if (include?.mealToken) cloned.mealToken = mealTokensStore.find((m) => m.attendanceId === cloned.id) || null;
        return cloned;
      },
      findMany: async ({ where, include }) => {
        let results = [...attendancesStore];
        if (where?.customerId) results = results.filter((a) => a.customerId === where.customerId);
        if (where?.date) {
          const target = new Date(where.date).toISOString().slice(0, 10);
          results = results.filter((a) => new Date(a.date).toISOString().slice(0, 10) === target);
        }
        return results.map((rec) => {
          const cloned = { ...rec };
          if (include?.customer) cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
          if (include?.mealToken) cloned.mealToken = mealTokensStore.find((m) => m.attendanceId === cloned.id) || null;
          return cloned;
        });
      },
      update: async ({ where, data }) => {
        const idx = attendancesStore.findIndex((a) => a.id === where.id);
        if (idx === -1) throw new Error("Attendance not found");
        attendancesStore[idx] = { ...attendancesStore[idx], ...data };
        return attendancesStore[idx];
      },
    };

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
        const newPoll = { id: `poll-${Date.now()}`, ...create, createdAt: new Date(), updatedAt: new Date() };
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
    setMockTime(TEST_0830_IST);
  });

  afterEach(() => {
    resetMockTime();
  });

  // 1. Customer cannot recharge (403)
  test("Test 1: Customer cannot invoke owner recharge endpoint (403 Forbidden)", async () => {
    const res = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/recharge`)
      .set("Cookie", customerCookie)
      .send({ amount: 10 });

    assert.equal(res.status, 403);
  });

  // 2. Recharge amount validations
  test("Test 2: Non-positive or non-integer recharge amount is rejected (400 Bad Request)", async () => {
    // 0 amount
    const resZero = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/recharge`)
      .set("Cookie", ownerCookie)
      .send({ amount: 0 });
    assert.equal(resZero.status, 400);

    // Negative amount
    const resNeg = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/recharge`)
      .set("Cookie", ownerCookie)
      .send({ amount: -5 });
    assert.equal(resNeg.status, 400);

    // Non-integer amount
    const resFloat = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/recharge`)
      .set("Cookie", ownerCookie)
      .send({ amount: 12.5 });
    assert.equal(resFloat.status, 400);
  });

  // 3. Full Integration Sequence: Balance 1 -> Token Deduction -> Balance 0 (Payment Suspended) -> Recharge +30 -> Resumed Service
  test("Test 3: Full Integration Sequence: Balance 1 -> Meal Token -> Payment Suspended -> Recharge +30 -> Resumed Service", async () => {
    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    assert.equal(cust.remainingTiffins, 1, "Customer starts with balance 1");

    // Step A: Mark attendance PRESENT for Lunch Restaurant
    const attRes = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });
    assert.equal(attRes.status, 200);

    // Cast poll vote for RESTAURANT
    const voteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "RESTAURANT" });
    assert.equal(voteRes.status, 200);

    const attRecord = attendancesStore.find((a) => a.customerId === customerProfileId && a.mealType === "LUNCH");
    assert.ok(attRecord);
    assert.equal(attRecord.status, "PRESENT");
    assert.equal(attRecord.location, "RESTAURANT");

    // Step B: Owner generates meal token for attendance
    const tokenRes = await request(app)
      .post(`/api/owner/meal-tokens/${attRecord.id}`)
      .set("Cookie", ownerCookie);

    assert.equal(tokenRes.status, 201);
    assert.equal(tokenRes.body.mealToken.token, "01-10-LU-R-001");

    // Balance is now 0
    assert.equal(cust.remainingTiffins, 0);

    // Exactly one MEAL_TOKEN transaction created
    const mealTxs = tiffinTransactionsStore.filter((t) => t.type === "MEAL_TOKEN");
    assert.equal(mealTxs.length, 1);
    assert.equal(mealTxs[0].quantity, -1);

    // Step C: Next day attendance operation is blocked by payment suspension
    const fridayDate = parseBusinessDate("2026-10-02");
    setMockTime("2026-10-02T03:00:00.000Z");

    const blockedAttRes = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(blockedAttRes.status, 409);
    assert.match(blockedAttRes.body.error, /payment-suspended/);

    // Step D: Owner performs cash recharge +30
    const rechargeRes = await request(app)
      .post(`/api/owner/customers/${customerProfileId}/recharge`)
      .set("Cookie", ownerCookie)
      .send({ amount: 30, reason: "Monthly cash subscription" });

    assert.equal(rechargeRes.status, 200);
    assert.equal(cust.remainingTiffins, 30);
    assert.equal(rechargeRes.body.customer.remainingTiffins, 30);

    // Verify CASH_RECHARGE transaction exists
    const rechargeTx = tiffinTransactionsStore.find((t) => t.type === "CASH_RECHARGE");
    assert.ok(rechargeTx);
    assert.equal(rechargeTx.quantity, 30);

    // Verify ledger consistency invariant: SUM(all quantities) == remainingTiffins
    const allTxs = tiffinTransactionsStore.filter((t) => t.customerId === customerProfileId);
    const ledgerSum = allTxs.reduce((sum, tx) => sum + tx.quantity, 0);
    assert.equal(ledgerSum, cust.remainingTiffins, "Ledger sum must strictly equal customer remainingTiffins (30)");

    // Verify AuditLog created
    const rechargeAudit = auditLogsStore.find((a) => a.action === "OWNER_CASH_RECHARGE");
    assert.ok(rechargeAudit);
    assert.equal(rechargeAudit.metadata.rechargeAmount, 30);

    // Step E: Customer can now mark attendance again because payment suspension cleared
    const resumedAttRes = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(resumedAttRes.status, 200);
    assert.equal(resumedAttRes.body.attendance.status, "PRESENT");
  });
});
