import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { setMockTime, resetMockTime, getBusinessDate, parseBusinessDate } from "../src/utils/businessTime.js";
import { generateMealToken, formatTokenString } from "../src/services/mealTokenService.js";

describe("Phase 5: Meal Token Generation + Exactly-Once Tiffin Deduction Tests", () => {
  // In-memory mock database stores mirroring PostgreSQL
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let pollsStore = [];
  let pollVotesStore = [];
  let mealTokensStore = [];
  let mealCountersStore = [];
  let tiffinTransactionsStore = [];
  let auditLogsStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  const ownerUserId = "owner-uuid-phase5";
  const customerUserId = "customer-uuid-phase5";
  const customerProfileId = "cust-profile-uuid-phase5";

  // Business dates
  // Wednesday 2026-09-30
  const WEDNESDAY_DATE = parseBusinessDate("2026-09-30");
  const WEDNESDAY_1000_IST = "2026-09-30T04:30:00.000Z";

  // Thursday 2026-10-01
  const THURSDAY_DATE = parseBusinessDate("2026-10-01");

  // Sunday 2026-10-04
  const SUNDAY_DATE = parseBusinessDate("2026-10-04");
  const SUNDAY_1000_IST = "2026-10-04T04:30:00.000Z";

  before(async () => {
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    usersStore = [
      {
        id: ownerUserId,
        loginIdentifier: "owner@swayamsiddha.local",
        role: "OWNER",
        passwordHash: ownerHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: customerUserId,
        loginIdentifier: "customer@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    customerProfilesStore = [
      {
        id: customerProfileId,
        userId: customerUserId,
        name: "Phase 5 Test Customer",
        phone: "+919876543210",
        profilePictureUrl: null,
        remainingTiffins: 56,
        serviceStatus: "ACTIVE",
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    tiffinTransactionsStore = [
      {
        id: "init-tx-56",
        customerId: customerProfileId,
        quantity: 56,
        type: "INITIAL_BALANCE",
        reason: "Initial enrollment balance",
        attendanceId: null,
        createdBy: ownerUserId,
        createdAt: new Date(),
      },
    ];

    // Configure Prisma Mocks with transactional ACID snapshotting
    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        // Create deep snapshots for rollback simulation
        const snapProfiles = JSON.parse(JSON.stringify(customerProfilesStore));
        const snapCounters = JSON.parse(JSON.stringify(mealCountersStore));
        const snapTokens = JSON.parse(JSON.stringify(mealTokensStore));
        const snapTransactions = JSON.parse(JSON.stringify(tiffinTransactionsStore));
        const snapAudits = JSON.parse(JSON.stringify(auditLogsStore));

        try {
          const res = await callbackOrArray(prisma);
          return res;
        } catch (err) {
          // Restore snapshots on error (Rollback)
          customerProfilesStore = snapProfiles;
          mealCountersStore = snapCounters;
          mealTokensStore = snapTokens;
          tiffinTransactionsStore = snapTransactions;
          auditLogsStore = snapAudits;
          throw err;
        }
      }
      return Promise.all(callbackOrArray);
    };

    // User mock
    prisma.user.findUnique = async ({ where }) => {
      if (where.loginIdentifier) {
        return usersStore.find((u) => u.loginIdentifier === where.loginIdentifier) || null;
      }
      if (where.id) {
        return usersStore.find((u) => u.id === where.id) || null;
      }
      return null;
    };

    // CustomerProfile mock
    prisma.customerProfile.findUnique = async ({ where }) => {
      if (where.id) {
        return customerProfilesStore.find((p) => p.id === where.id) || null;
      }
      if (where.userId) {
        return customerProfilesStore.find((p) => p.userId === where.userId) || null;
      }
      return null;
    };

    prisma.customerProfile.updateMany = async ({ where, data }) => {
      const match = customerProfilesStore.find((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.remainingTiffins?.gt !== undefined && !(p.remainingTiffins > where.remainingTiffins.gt)) {
          return false;
        }
        return true;
      });

      if (!match) {
        return { count: 0 };
      }

      if (data.remainingTiffins?.decrement !== undefined) {
        match.remainingTiffins -= data.remainingTiffins.decrement;
      }
      return { count: 1 };
    };

    prisma.serviceSuspension = {
      findFirst: async () => null,
      findMany: async () => [],
    };

    // Attendance mock
    prisma.attendance.findUnique = async ({ where, include }) => {
      let record = null;
      if (where.id) {
        record = attendancesStore.find((a) => a.id === where.id) || null;
      } else if (where.customerId_date_mealType) {
        const { customerId, date, mealType } = where.customerId_date_mealType;
        const targetDate = new Date(date).toISOString().slice(0, 10);
        record =
          attendancesStore.find(
            (a) =>
              a.customerId === customerId &&
              new Date(a.date).toISOString().slice(0, 10) === targetDate &&
              a.mealType === mealType
          ) || null;
      }

      if (!record) return null;

      const cloned = { ...record };
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
      if (where?.customerId) {
        results = results.filter((a) => a.customerId === where.customerId);
      }
      if (where?.date) {
        const targetDate = new Date(where.date).toISOString().slice(0, 10);
        results = results.filter((a) => new Date(a.date).toISOString().slice(0, 10) === targetDate);
      }
      return results.map((record) => {
        const cloned = { ...record };
        if (include?.customer) {
          cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
        }
        if (include?.mealToken) {
          cloned.mealToken = mealTokensStore.find((m) => m.attendanceId === cloned.id) || null;
        }
        return cloned;
      });
    };

    prisma.attendance.update = async ({ where, data }) => {
      const idx = attendancesStore.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error("Attendance not found");
      attendancesStore[idx] = { ...attendancesStore[idx], ...data };
      return attendancesStore[idx];
    };

    // Poll mock
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
          date: create.date,
          mealType: create.mealType,
          opensAt: create.opensAt,
          closesAt: create.closesAt,
          status: create.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pollsStore.push(newPoll);
        return newPoll;
      },
      findUnique: async ({ where }) => {
        if (where.id) return pollsStore.find((p) => p.id === where.id) || null;
        if (where.date_mealType) {
          const targetDate = new Date(where.date_mealType.date).toISOString().split("T")[0];
          return (
            pollsStore.find(
              (p) =>
                new Date(p.date).toISOString().split("T")[0] === targetDate &&
                p.mealType === where.date_mealType.mealType
            ) || null
          );
        }
        return null;
      },
    };

    prisma.pollVote = {
      findUnique: async ({ where }) => {
        if (where.pollId_customerId) {
          return (
            pollVotesStore.find(
              (v) =>
                v.pollId === where.pollId_customerId.pollId &&
                v.customerId === where.pollId_customerId.customerId
            ) || null
          );
        }
        return null;
      },
    };

    // MealCounter mock
    prisma.mealCounter.upsert = async ({ where, update, create }) => {
      const { date, mealType, location } = where.date_mealType_location;
      const targetDate = new Date(date).toISOString().slice(0, 10);

      let counter = mealCountersStore.find(
        (c) =>
          new Date(c.date).toISOString().slice(0, 10) === targetDate &&
          c.mealType === mealType &&
          c.location === location
      );

      if (counter) {
        if (update.nextSerial?.increment !== undefined) {
          counter.nextSerial += update.nextSerial.increment;
        }
        return { ...counter };
      } else {
        const newCounter = {
          id: `counter-${Date.now()}-${Math.random()}`,
          date: new Date(create.date),
          mealType: create.mealType,
          location: create.location,
          nextSerial: create.nextSerial || 2,
        };
        mealCountersStore.push(newCounter);
        return { ...newCounter };
      }
    };

    // MealToken mock
    prisma.mealToken.findUnique = async ({ where }) => {
      if (where.attendanceId) {
        return mealTokensStore.find((m) => m.attendanceId === where.attendanceId) || null;
      }
      if (where.token) {
        return mealTokensStore.find((m) => m.token === where.token) || null;
      }
      if (where.id) {
        return mealTokensStore.find((m) => m.id === where.id) || null;
      }
      return null;
    };

    prisma.mealToken.create = async ({ data }) => {
      // Check unique constraints
      const conflict = mealTokensStore.find(
        (m) => m.attendanceId === data.attendanceId || m.token === data.token
      );
      if (conflict) {
        const err = new Error("Unique constraint failed on the fields: (`attendanceId`)");
        err.code = "P2002";
        err.meta = { target: ["attendanceId"] };
        throw err;
      }

      const newToken = {
        id: `token-${Date.now()}-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      mealTokensStore.push(newToken);
      return newToken;
    };

    // TiffinTransaction mock
    prisma.tiffinTransaction.create = async ({ data }) => {
      const newTx = {
        id: `tx-${Date.now()}-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      tiffinTransactionsStore.push(newTx);
      return newTx;
    };

    prisma.tiffinTransaction.findMany = async ({ where }) => {
      let results = [...tiffinTransactionsStore];
      if (where?.customerId) {
        results = results.filter((t) => t.customerId === where.customerId);
      }
      return results;
    };

    // AuditLog mock
    prisma.auditLog.create = async ({ data }) => {
      const newAudit = {
        id: `audit-${Date.now()}-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      auditLogsStore.push(newAudit);
      return newAudit;
    };

    // Session mock
    prisma.session.create = async ({ data }) => {
      const session = { id: `session-${Date.now()}-${Math.random()}`, ...data };
      sessionsStore.push(session);
      return session;
    };

    prisma.session.findUnique = async ({ where, include }) => {
      const session = sessionsStore.find((s) => s.token === where.token);
      if (!session) return null;
      if (include?.user) {
        const user = usersStore.find((u) => u.id === session.userId);
        return { ...session, user };
      }
      return session;
    };

    // Log in OWNER and CUSTOMER to acquire session cookies
    const ownerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "owner@swayamsiddha.local", password: OWNER_PASSWORD });
    assert.equal(ownerRes.status, 200);
    ownerCookie = ownerRes.headers["set-cookie"]?.[0];

    const customerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    assert.equal(customerRes.status, 200);
    customerCookie = customerRes.headers["set-cookie"]?.[0];
  });

  afterEach(() => {
    resetMockTime();
  });

  // A. Lunch Restaurant token
  test("Test A: Lunch Restaurant token generates DD-MM-LU-R-001 for PRESENT + RESTAURANT", async () => {
    const attId = "att-lunch-rest-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "CUSTOMER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);
    assert.equal(res.body.isNew, true);
    assert.equal(res.body.mealToken.token, "30-09-LU-R-001");
    assert.equal(res.body.mealToken.serialNumber, 1);
  });

  // B. Lunch College token
  test("Test B: Lunch College token generates DD-MM-LU-C-001 for PRESENT + COLLEGE", async () => {
    const attId = "att-lunch-coll-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "COLLEGE",
      source: "CUSTOMER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);
    assert.equal(res.body.isNew, true);
    assert.equal(res.body.mealToken.token, "30-09-LU-C-001");
    assert.equal(res.body.mealToken.serialNumber, 1);
  });

  // C. Dinner Restaurant token
  test("Test C: Dinner Restaurant token generates DD-MM-DN-R-001 for PRESENT + RESTAURANT", async () => {
    const attId = "att-dinner-rest-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "CUSTOMER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);
    assert.equal(res.body.isNew, true);
    assert.equal(res.body.mealToken.token, "30-09-DN-R-001");
    assert.equal(res.body.mealToken.serialNumber, 1);
  });

  // D. Invalid ABSENT attendance
  test("Test D: Invalid ABSENT attendance is rejected", async () => {
    const attId = "att-absent-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "ABSENT",
      location: null,
      source: "CUSTOMER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Attendance status is 'ABSENT'/);
  });

  // E. Invalid UNMARKED attendance
  test("Test E: Invalid UNMARKED attendance is rejected", async () => {
    const attId = "att-unmarked-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "UNMARKED",
      location: null,
      source: "AUTO",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Attendance status is 'UNMARKED'/);
  });

  // F. PRESENT + null location
  test("Test F: PRESENT attendance with null location is rejected", async () => {
    const attId = "att-null-loc-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: null,
      source: "CUSTOMER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /location is pending\/null/);
  });

  // G. Sunday dinner
  test("Test G: Sunday dinner token generation is strictly rejected", async () => {
    const attId = "att-sunday-dinner-1";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: SUNDAY_DATE,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "OWNER",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Dinner service is not available on Sunday/);
  });

  // H. Zero balance rejected
  test("Test H: Zero balance attendance is rejected with 409 Conflict, no token or transaction created", async () => {
    // Create zero balance customer
    const zeroCustProfileId = "cust-zero-balance";
    customerProfilesStore.push({
      id: zeroCustProfileId,
      userId: "cust-zero-user",
      name: "Zero Balance Customer",
      phone: "+919876543299",
      remainingTiffins: 0,
      serviceStatus: "ACTIVE",
    });

    const attId = "att-zero-balance-1";
    attendancesStore.push({
      id: attId,
      customerId: zeroCustProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const tokensBefore = mealTokensStore.length;
    const txBefore = tiffinTransactionsStore.length;

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 409);
    assert.match(res.body.error, /Insufficient tiffin balance/);
    assert.equal(mealTokensStore.length, tokensBefore, "No meal token should be created");
    assert.equal(tiffinTransactionsStore.length, txBefore, "No ledger transaction should be created");
  });

  // I. Balance deduction
  test("Test I: Balance deduction decrements customer remainingTiffins by exactly 1", async () => {
    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    const balanceBefore = cust.remainingTiffins;

    const attId = "att-balance-dec-test";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);
    assert.equal(cust.remainingTiffins, balanceBefore - 1);
  });

  // J. Ledger transaction
  test("Test J: Exactly one MEAL_TOKEN TiffinTransaction with quantity -1 is created", async () => {
    const attId = "att-ledger-tx-test";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);

    const txs = tiffinTransactionsStore.filter((t) => t.attendanceId === attId);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].quantity, -1);
    assert.equal(txs[0].type, "MEAL_TOKEN");
  });

  // K. Ledger consistency
  test("Test K: Ledger consistency invariant sum(TiffinTransaction.quantity) == remainingTiffins holds", async () => {
    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    const allTxs = tiffinTransactionsStore.filter((t) => t.customerId === customerProfileId);
    const ledgerSum = allTxs.reduce((sum, tx) => sum + tx.quantity, 0);

    assert.equal(ledgerSum, cust.remainingTiffins);
  });

  // L. Same attendance repeated (idempotency)
  test("Test L: Same attendance repeated returns identical token without duplicate deductions or counters", async () => {
    const attId = "att-idempotent-repeat";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "COLLEGE",
    });

    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    const balanceBefore = cust.remainingTiffins;

    // First call: Generates token
    const res1 = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);
    assert.equal(res1.status, 201);
    assert.equal(res1.body.isNew, true);
    const tokenStr = res1.body.mealToken.token;

    // Second call: Returns existing token
    const res2 = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.isNew, false);
    assert.equal(res2.body.mealToken.token, tokenStr);

    // Assert exactly one deduction occurred
    assert.equal(cust.remainingTiffins, balanceBefore - 1);
    const matchingTxs = tiffinTransactionsStore.filter((t) => t.attendanceId === attId);
    assert.equal(matchingTxs.length, 1);
  });

  // M. Same attendance concurrent requests
  test("Test M: Same attendance concurrent requests produce exactly one token and one deduction", async () => {
    const attId = "att-concurrent-same";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: WEDNESDAY_DATE,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const cust = customerProfilesStore.find((p) => p.id === customerProfileId);
    const balanceBefore = cust.remainingTiffins;

    // Two simultaneous calls
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/owner/meal-tokens/${attId}`).set("Cookie", ownerCookie),
      request(app).post(`/api/owner/meal-tokens/${attId}`).set("Cookie", ownerCookie),
    ]);

    assert.ok([200, 201].includes(res1.status));
    assert.ok([200, 201].includes(res2.status));
    assert.equal(res1.body.mealToken.token, res2.body.mealToken.token);

    // Exactly one deduction
    assert.equal(cust.remainingTiffins, balanceBefore - 1);
    const matchingTxs = tiffinTransactionsStore.filter((t) => t.attendanceId === attId);
    assert.equal(matchingTxs.length, 1);
  });

  // N. Two different attendances with balance = 1 concurrent generation
  test("Test N: Two different attendances with customer balance = 1 concurrently: exactly one succeeds, one fails, balance = 0", async () => {
    // Create customer with exactly 1 tiffin
    const balanceOneCustId = "cust-balance-one";
    customerProfilesStore.push({
      id: balanceOneCustId,
      userId: "cust-user-one",
      name: "Balance One Customer",
      phone: "+919876543201",
      remainingTiffins: 1,
      serviceStatus: "ACTIVE",
    });

    const att1Id = "att-concurrent-one-1";
    const att2Id = "att-concurrent-one-2";

    attendancesStore.push(
      {
        id: att1Id,
        customerId: balanceOneCustId,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      },
      {
        id: att2Id,
        customerId: balanceOneCustId,
        date: WEDNESDAY_DATE,
        mealType: "DINNER",
        status: "PRESENT",
        location: "RESTAURANT",
      }
    );

    const [res1, res2] = await Promise.all([
      request(app).post(`/api/owner/meal-tokens/${att1Id}`).set("Cookie", ownerCookie),
      request(app).post(`/api/owner/meal-tokens/${att2Id}`).set("Cookie", ownerCookie),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [201, 409], "One request must succeed (201) and the second must fail with 409 Conflict");

    const cust = customerProfilesStore.find((p) => p.id === balanceOneCustId);
    assert.equal(cust.remainingTiffins, 0, "Balance must be exactly 0, never negative");
  });

  // O. Counter sequencing
  test("Test O: Counter sequencing on same date + meal + location produces sequential serials (001, 002, 003)", async () => {
    // Clear counters for Thursday to test pure 001, 002, 003 sequence
    const att1 = "att-seq-1";
    const att2 = "att-seq-2";
    const att3 = "att-seq-3";

    attendancesStore.push(
      {
        id: att1,
        customerId: customerProfileId,
        date: THURSDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      },
      {
        id: att2,
        customerId: customerProfileId,
        date: THURSDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      },
      {
        id: att3,
        customerId: customerProfileId,
        date: THURSDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      }
    );

    const res1 = await request(app).post(`/api/owner/meal-tokens/${att1}`).set("Cookie", ownerCookie);
    const res2 = await request(app).post(`/api/owner/meal-tokens/${att2}`).set("Cookie", ownerCookie);
    const res3 = await request(app).post(`/api/owner/meal-tokens/${att3}`).set("Cookie", ownerCookie);

    assert.equal(res1.body.mealToken.token, "01-10-LU-R-001");
    assert.equal(res2.body.mealToken.token, "01-10-LU-R-002");
    assert.equal(res3.body.mealToken.token, "01-10-LU-R-003");
  });

  // P. Counter separation
  test("Test P: Independent counters per date + mealType + location start at 001 independently", async () => {
    const testDate = parseBusinessDate("2026-10-02"); // Friday 2026-10-02

    const attLU_R = "att-sep-lu-r";
    const attLU_C = "att-sep-lu-c";
    const attDN_R = "att-sep-dn-r";

    attendancesStore.push(
      {
        id: attLU_R,
        customerId: customerProfileId,
        date: testDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      },
      {
        id: attLU_C,
        customerId: customerProfileId,
        date: testDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "COLLEGE",
      },
      {
        id: attDN_R,
        customerId: customerProfileId,
        date: testDate,
        mealType: "DINNER",
        status: "PRESENT",
        location: "RESTAURANT",
      }
    );

    const resLU_R = await request(app).post(`/api/owner/meal-tokens/${attLU_R}`).set("Cookie", ownerCookie);
    const resLU_C = await request(app).post(`/api/owner/meal-tokens/${attLU_C}`).set("Cookie", ownerCookie);
    const resDN_R = await request(app).post(`/api/owner/meal-tokens/${attDN_R}`).set("Cookie", ownerCookie);

    assert.equal(resLU_R.body.mealToken.token, "02-10-LU-R-001");
    assert.equal(resLU_C.body.mealToken.token, "02-10-LU-C-001");
    assert.equal(resDN_R.body.mealToken.token, "02-10-DN-R-001");
  });

  // Q. Counter rollback on transaction failure
  test("Test Q: Failed transaction does not permanently consume counter sequence", async () => {
    const testDate = parseBusinessDate("2026-10-05"); // Monday

    const failAttId = "att-rollback-fail";
    const successAttId = "att-rollback-success";

    attendancesStore.push(
      {
        id: failAttId,
        customerId: customerProfileId,
        date: testDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      },
      {
        id: successAttId,
        customerId: customerProfileId,
        date: testDate,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
      }
    );

    // Intentionally inject a transient error during mealToken.create
    const origCreate = prisma.mealToken.create;
    let injectedError = true;
    prisma.mealToken.create = async (args) => {
      if (injectedError) {
        injectedError = false;
        throw new Error("Simulated database failure during token persistence");
      }
      return origCreate(args);
    };

    // First attempt fails and rolls back
    const failRes = await request(app)
      .post(`/api/owner/meal-tokens/${failAttId}`)
      .set("Cookie", ownerCookie);
    assert.equal(failRes.status, 500);

    // Restore original method
    prisma.mealToken.create = origCreate;

    // Subsequent token generation should receive 001 because previous transaction rolled back
    const successRes = await request(app)
      .post(`/api/owner/meal-tokens/${successAttId}`)
      .set("Cookie", ownerCookie);

    assert.equal(successRes.status, 201);
    assert.equal(successRes.body.mealToken.token, "05-10-LU-R-001");
  });

  // R. Token uniqueness
  test("Test R: All generated tokens have unique token strings", () => {
    const tokenStrings = mealTokensStore.map((t) => t.token);
    const uniqueTokens = new Set(tokenStrings);
    assert.equal(tokenStrings.length, uniqueTokens.size, "No duplicate token strings allowed");
  });

  // S. CUSTOMER cannot invoke owner token generation (403)
  test("Test S: CUSTOMER POST /api/owner/meal-tokens/:attendanceId returns 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/owner/meal-tokens/att-lunch-rest-1")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 403);
  });

  // T. Unauthenticated request (401)
  test("Test T: Unauthenticated POST /api/owner/meal-tokens/:attendanceId returns 401 Unauthorized", async () => {
    const res = await request(app).post("/api/owner/meal-tokens/att-lunch-rest-1");

    assert.equal(res.status, 401);
  });

  // U. OWNER can invoke token generation (success)
  test("Test U: OWNER POST /api/owner/meal-tokens/:attendanceId succeeds with 200/201", async () => {
    const testDate = parseBusinessDate("2026-10-06");
    const attId = "att-owner-invoke-test";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: testDate,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    const res = await request(app)
      .post(`/api/owner/meal-tokens/${attId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 201);
    assert.ok(res.body.mealToken);
    assert.equal(res.body.mealToken.attendanceId, attId);
  });

  // V. Owner edit after token rejected
  test("Test V: Owner edit after token generation is rejected with 409 Conflict", async () => {
    const tokenizedAttId = "att-lunch-rest-1"; // Already has a MealToken generated in Test A

    const res = await request(app)
      .patch(`/api/owner/attendance/${tokenizedAttId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "ABSENT" });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /Cannot modify attendance: A meal token/);
  });

  // W. Customer meal state exposes meal token
  test("Test W: Customer GET /api/customer/meals/today exposes safe mealToken metadata when present", async () => {
    setMockTime(WEDNESDAY_1000_IST);

    const res = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.lunch.mealToken);
    assert.equal(res.body.lunch.mealToken.token, "30-09-LU-R-001");
    assert.ok(res.body.lunch.mealToken.tokenId);
    assert.ok(res.body.lunch.mealToken.generatedAt);
  });

  // X. No automatic finalization
  test("Test X: Verify Phase 5 does not generate tokens automatically at 16:00 or 23:00", async () => {
    const tokensBefore = mealTokensStore.length;

    // Simulate clock reaching 16:00 IST (10:30 UTC)
    setMockTime("2026-09-30T10:30:00.000Z");
    await request(app).get("/api/health");

    // Simulate clock reaching 23:00 IST (17:30 UTC)
    setMockTime("2026-09-30T17:30:00.000Z");
    await request(app).get("/api/health");

    assert.equal(
      mealTokensStore.length,
      tokensBefore,
      "No automated tokens should be created by clock time in Phase 5"
    );
  });

  // Y. No duplicate MEAL_TOKEN transaction
  test("Test Y: Repeated token generation never creates duplicate MEAL_TOKEN transactions", async () => {
    const attId = "att-dup-check";
    attendancesStore.push({
      id: attId,
      customerId: customerProfileId,
      date: THURSDAY_DATE,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
    });

    await request(app).post(`/api/owner/meal-tokens/${attId}`).set("Cookie", ownerCookie);
    await request(app).post(`/api/owner/meal-tokens/${attId}`).set("Cookie", ownerCookie);
    await request(app).post(`/api/owner/meal-tokens/${attId}`).set("Cookie", ownerCookie);

    const transactions = tiffinTransactionsStore.filter((t) => t.attendanceId === attId);
    assert.equal(transactions.length, 1, "Exactly one MEAL_TOKEN transaction must exist for the attendance");
  });

  // Z. Token format validation
  test("Test Z: Generated token strictly matches DD-MM-LU/DN-R/C-SSS and never uses 01/02 for meal", () => {
    const TOKEN_REGEX = /^\d{2}-\d{2}-(LU|DN)-(R|C)-\d{3}$/;

    for (const token of mealTokensStore) {
      assert.ok(
        TOKEN_REGEX.test(token.token),
        `Token '${token.token}' must strictly conform to DD-MM-LU/DN-R/C-SSS`
      );
      assert.ok(!token.token.includes("-01-"), "Token must not contain '01' as meal code");
      assert.ok(!token.token.includes("-02-"), "Token must not contain '02' as meal code");
    }
  });
});
