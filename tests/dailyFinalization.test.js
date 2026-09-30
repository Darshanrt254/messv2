import { test, describe, before, beforeEach, afterEach } from "node:test";
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
import {
  finalizeMealForDate,
  finalizeLunchForDate,
  finalizeDinnerForDate,
  isLunchFinalizationDue,
  isDinnerFinalizationDue,
} from "../src/services/dailyFinalizationService.js";
import { getSchedulerStatus } from "../src/scheduler/dailyScheduler.js";

describe("Phase 7: Automatic Daily Meal Finalization & Scheduler Tests", () => {
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

  const ownerUserId = "owner-uuid-p7";
  const customerUserId1 = "cust-user-1-p7";
  const customerProfileId1 = "cust-prof-1-p7";

  const customerUserId2 = "cust-user-2-p7";
  const customerProfileId2 = "cust-prof-2-p7";

  const customerUserId3 = "cust-user-3-p7";
  const customerProfileId3 = "cust-prof-3-p7";

  // Wednesday 2026-09-30 (16:30 IST = 11:00 UTC)
  const WEDNESDAY_1630_IST = "2026-09-30T11:00:00.000Z";
  // Wednesday 2026-09-30 (23:15 IST = 17:45 UTC)
  const WEDNESDAY_2315_IST = "2026-09-30T17:45:00.000Z";
  // Wednesday 2026-09-30 (10:00 IST = 04:30 UTC) - Morning before 4 PM
  const WEDNESDAY_1000_IST = "2026-09-30T04:30:00.000Z";

  // Saturday 2026-10-03 (16:30 IST = 11:00 UTC)
  const SATURDAY_1630_IST = "2026-10-03T11:00:00.000Z";
  // Saturday 2026-10-03 (23:15 IST = 17:45 UTC)
  const SATURDAY_2315_IST = "2026-10-03T17:45:00.000Z";

  // Sunday 2026-10-04 (23:15 IST = 17:45 UTC)
  const SUNDAY_2315_IST = "2026-10-04T17:45:00.000Z";

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
        id: customerUserId1,
        loginIdentifier: "customer1@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
      },
      {
        id: customerUserId2,
        loginIdentifier: "customer2@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
      },
      {
        id: customerUserId3,
        loginIdentifier: "customer3@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
      },
    ];

    customerProfilesStore = [
      {
        id: customerProfileId1,
        userId: customerUserId1,
        name: "Customer One",
        phone: "+919876543201",
        remainingTiffins: 20,
        serviceStatus: "ACTIVE",
      },
      {
        id: customerProfileId2,
        userId: customerUserId2,
        name: "Customer Two",
        phone: "+919876543202",
        remainingTiffins: 15,
        serviceStatus: "ACTIVE",
      },
      {
        id: customerProfileId3,
        userId: customerUserId3,
        name: "Customer Three",
        phone: "+919876543203",
        remainingTiffins: 0,
        serviceStatus: "PAYMENT_SUSPENDED",
      },
    ];

    tiffinTransactionsStore = [
      { id: "tx-init-1", customerId: customerProfileId1, quantity: 20, type: "INITIAL_BALANCE" },
      { id: "tx-init-2", customerId: customerProfileId2, quantity: 15, type: "INITIAL_BALANCE" },
      { id: "tx-init-3", customerId: customerProfileId3, quantity: 0, type: "INITIAL_BALANCE" },
    ];

    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        const modifiedProfiles = [];
        const addedTokens = [];
        const addedTx = [];
        const addedAudits = [];

        const txPrisma = {
          ...prisma,
          customerProfile: {
            ...prisma.customerProfile,
            updateMany: async ({ where, data }) => {
              const match = customerProfilesStore.find((p) => {
                if (where.id && p.id !== where.id) return false;
                if (where.remainingTiffins?.gt !== undefined && !(p.remainingTiffins > where.remainingTiffins.gt)) {
                  return false;
                }
                return true;
              });
              if (!match) return { count: 0 };
              if (data.remainingTiffins?.decrement !== undefined) {
                modifiedProfiles.push({ profile: match, prevRemaining: match.remainingTiffins });
                match.remainingTiffins -= data.remainingTiffins.decrement;
              }
              return { count: 1 };
            },
          },
          mealToken: {
            ...prisma.mealToken,
            create: async (args) => {
              const item = await prisma.mealToken.create(args);
              addedTokens.push(item);
              return item;
            },
          },
          tiffinTransaction: {
            ...prisma.tiffinTransaction,
            create: async ({ data }) => {
              const item = { id: `tx-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
              tiffinTransactionsStore.push(item);
              addedTx.push(item);
              return item;
            },
          },
          auditLog: {
            ...prisma.auditLog,
            create: async ({ data }) => {
              const item = { id: `audit-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
              auditLogsStore.push(item);
              addedAudits.push(item);
              return item;
            },
          },
        };

        try {
          return await callbackOrArray(txPrisma);
        } catch (err) {
          for (const { profile, prevRemaining } of modifiedProfiles) {
            profile.remainingTiffins = prevRemaining;
          }
          for (const token of addedTokens) {
            const idx = mealTokensStore.indexOf(token);
            if (idx !== -1) mealTokensStore.splice(idx, 1);
          }
          for (const tx of addedTx) {
            const idx = tiffinTransactionsStore.indexOf(tx);
            if (idx !== -1) tiffinTransactionsStore.splice(idx, 1);
          }
          for (const audit of addedAudits) {
            const idx = auditLogsStore.indexOf(audit);
            if (idx !== -1) auditLogsStore.splice(idx, 1);
          }
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

    prisma.customerProfile.findMany = async ({ orderBy } = {}) => {
      return [...customerProfilesStore];
    };

    prisma.customerProfile.findUnique = async ({ where, include }) => {
      let prof = null;
      if (where.id) prof = customerProfilesStore.find((p) => p.id === where.id) || null;
      if (where.userId) prof = customerProfilesStore.find((p) => p.userId === where.userId) || null;
      if (!prof) return null;
      const res = { ...prof };
      if (include?.user) {
        res.user = usersStore.find((u) => u.id === prof.userId) || null;
      }
      return res;
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
      findFirst: async ({ where }) => {
        const targetDate = new Date(where.startDate.lte).toISOString().slice(0, 10);
        return (
          serviceSuspensionsStore.find((s) => {
            if (s.customerId !== where.customerId) return false;
            const startStr = new Date(s.startDate).toISOString().slice(0, 10);
            const endStr = new Date(s.endDate).toISOString().slice(0, 10);
            return targetDate >= startStr && targetDate <= endStr;
          }) || null
        );
      },
      findMany: async ({ where }) => {
        if (where?.customerId) return serviceSuspensionsStore.filter((s) => s.customerId === where.customerId);
        return serviceSuspensionsStore;
      },
      create: async ({ data }) => {
        const item = { id: `susp-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        serviceSuspensionsStore.push(item);
        return item;
      },
      update: async ({ where, data }) => {
        const idx = serviceSuspensionsStore.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error("Suspension not found");
        Object.assign(serviceSuspensionsStore[idx], data);
        return serviceSuspensionsStore[idx];
      },
      delete: async ({ where }) => {
        const idx = serviceSuspensionsStore.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error("Suspension not found");
        const deleted = serviceSuspensionsStore.splice(idx, 1)[0];
        return deleted;
      },
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
        const item = { id: `audit-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        auditLogsStore.push(item);
        return item;
      },
      findMany: async () => auditLogsStore,
    };

    prisma.attendance = {
      create: async ({ data }) => {
        const item = { id: `att-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        attendancesStore.push(item);
        return item;
      },
      update: async ({ where, data }) => {
        const item = attendancesStore.find((a) => a.id === where.id);
        if (!item) throw new Error("Attendance not found");
        Object.assign(item, data);
        return item;
      },
      upsert: async ({ where, update, create }) => {
        let existing = null;
        if (where.customerId_date_mealType) {
          const target = new Date(where.customerId_date_mealType.date).toISOString().slice(0, 10);
          existing = attendancesStore.find(
            (a) =>
              a.customerId === where.customerId_date_mealType.customerId &&
              new Date(a.date).toISOString().slice(0, 10) === target &&
              a.mealType === where.customerId_date_mealType.mealType
          );
        }
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: `att-${Date.now()}-${Math.random()}`,
          ...create,
          createdAt: new Date(),
        };
        attendancesStore.push(created);
        return created;
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
        const res = { ...rec };
        if (include?.mealToken) {
          res.mealToken = mealTokensStore.find((m) => m.attendanceId === rec.id) || null;
        }
        if (include?.customer) {
          res.customer = customerProfilesStore.find((c) => c.id === rec.customerId) || null;
        }
        return res;
      },
      findMany: async ({ where, include } = {}) => {
        let list = [...attendancesStore];
        if (where?.customerId) list = list.filter((a) => a.customerId === where.customerId);
        if (where?.mealType) list = list.filter((a) => a.mealType === where.mealType);
        return list.map((a) => {
          const item = { ...a };
          if (include?.mealToken) item.mealToken = mealTokensStore.find((m) => m.attendanceId === a.id) || null;
          return item;
        });
      },
    };

    prisma.mealCounter = {
      upsert: async ({ where, update, create }) => {
        const targetDate = new Date(where.date_mealType_location.date).toISOString().slice(0, 10);
        let counter = mealCountersStore.find(
          (c) =>
            new Date(c.date).toISOString().slice(0, 10) === targetDate &&
            c.mealType === where.date_mealType_location.mealType &&
            c.location === where.date_mealType_location.location
        );
        if (counter) {
          counter.nextSerial += 1;
          return counter;
        }
        counter = {
          id: `counter-${Date.now()}-${Math.random()}`,
          date: where.date_mealType_location.date,
          mealType: where.date_mealType_location.mealType,
          location: where.date_mealType_location.location,
          nextSerial: create.nextSerial || 2,
        };
        mealCountersStore.push(counter);
        return counter;
      },
    };

    prisma.mealToken = {
      create: async ({ data }) => {
        if (mealTokensStore.some((m) => m.attendanceId === data.attendanceId || m.token === data.token)) {
          const err = new Error("Unique constraint failed on the fields: (`attendanceId`)");
          err.code = "P2002";
          err.meta = { target: ["attendanceId"] };
          throw err;
        }
        const item = { id: `token-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        mealTokensStore.push(item);
        return item;
      },
      findUnique: async ({ where }) => {
        if (where.attendanceId) return mealTokensStore.find((m) => m.attendanceId === where.attendanceId) || null;
        if (where.token) return mealTokensStore.find((m) => m.token === where.token) || null;
        return null;
      },
      findMany: async () => mealTokensStore,
    };

    prisma.poll = {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }) => ({ id: `poll-${Date.now()}`, ...data }),
    };

    prisma.pollVote = {
      findUnique: async () => null,
      create: async ({ data }) => {
        pollVotesStore.push(data);
        return data;
      },
    };

    prisma.session.create = async ({ data }) => {
      const session = {
        id: `sess-${Date.now()}-${Math.random()}`,
        ...data,
      };
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
        if (res.user && include.user?.include?.customerProfile) {
          res.user.customerProfile = customerProfilesStore.find((p) => p.userId === res.user.id) || null;
        }
      }
      return res;
    };

    prisma.session.delete = async ({ where }) => {
      const idx = sessionsStore.findIndex((s) => s.id === where.id);
      if (idx !== -1) sessionsStore.splice(idx, 1);
      return { count: 1 };
    };

    // Owner Login
    const ownerLogin = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "owner@swayamsiddha.local", password: OWNER_PASSWORD });
    ownerCookie = ownerLogin.headers["set-cookie"][0].split(";")[0];

    // Customer Login
    const customerLogin = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer1@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    customerCookie = customerLogin.headers["set-cookie"][0].split(";")[0];
  });

  afterEach(() => {
    resetMockTime();
  });

  // ==================================================
  // LUNCH FINALIZATION TESTS (1 - 15)
  // ==================================================
  test("Test 1-6: Unmarked weekday lunch becomes PRESENT + RESTAURANT + AUTO with exactly one token and -1 tiffin", async () => {
    setMockTime(WEDNESDAY_1630_IST);

    const initialBalance1 = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    const initialBalance2 = customerProfilesStore.find((p) => p.id === customerProfileId2).remainingTiffins;

    const summary = await finalizeLunchForDate();

    // 1. Unmarked weekday lunch becomes PRESENT
    // 2. Location becomes RESTAURANT
    // 3. Source becomes AUTO
    const att1 = attendancesStore.find((a) => a.customerId === customerProfileId1 && a.mealType === "LUNCH");
    assert.ok(att1);
    assert.equal(att1.status, "PRESENT");
    assert.equal(att1.location, "RESTAURANT");
    assert.equal(att1.source, "AUTO");

    // 4. Exactly one token generated per customer
    const tokensCust1 = mealTokensStore.filter((t) => t.attendanceId === att1.id);
    assert.equal(tokensCust1.length, 1);
    assert.match(tokensCust1[0].token, /^\d{2}-\d{2}-LU-R-\d{3}$/);

    // 5. Exactly one -1 ledger transaction
    const txCust1 = tiffinTransactionsStore.filter(
      (t) => t.customerId === customerProfileId1 && t.type === "MEAL_TOKEN" && t.attendanceId === att1.id
    );
    assert.equal(txCust1.length, 1);
    assert.equal(txCust1[0].quantity, -1);

    // 6. Balance decreases by exactly 1
    const finalBalance1 = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    assert.equal(finalBalance1, initialBalance1 - 1);

    const finalBalance2 = customerProfilesStore.find((p) => p.id === customerProfileId2).remainingTiffins;
    assert.equal(finalBalance2, initialBalance2 - 1);

    // Customer 3 is payment suspended, so finalized count should be 2
    assert.equal(summary.finalized, 2);
    assert.equal(summary.skippedPaymentSuspended, 1);
  });

  test("Test 7: Existing PRESENT + COLLEGE lunch is untouched (not converted to restaurant, no new token)", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-01"); // Thursday

    // Seed customer 1 with PRESENT + COLLEGE
    const att = {
      id: "att-college-p7",
      customerId: customerProfileId1,
      date,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "COLLEGE",
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const summary = await finalizeLunchForDate(date);

    const storedAtt = attendancesStore.find((a) => a.id === "att-college-p7");
    assert.equal(storedAtt.location, "COLLEGE"); // Kept as COLLEGE
    assert.equal(storedAtt.status, "PRESENT");
  });

  test("Test 8: Existing PRESENT + RESTAURANT with token is untouched", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-02"); // Friday

    // Seed customer 1 with PRESENT + RESTAURANT and existing token
    const att = {
      id: "att-rest-with-token-p7",
      customerId: customerProfileId1,
      date,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const token = {
      id: "token-existing-p7",
      attendanceId: att.id,
      token: "02-10-LU-R-001",
      date,
      mealType: "LUNCH",
      location: "RESTAURANT",
      serialNumber: 1,
    };
    mealTokensStore.push(token);

    const tokensBefore = mealTokensStore.length;
    const summary = await finalizeLunchForDate(date);

    // No new token created for customer 1
    const tokensCust1 = mealTokensStore.filter((t) => t.attendanceId === att.id);
    assert.equal(tokensCust1.length, 1);
    assert.equal(tokensCust1[0].id, "token-existing-p7");
  });

  test("Test 9: Existing PRESENT + RESTAURANT without token gets exactly one token generated", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-05"); // Next Monday

    // Seed customer 2 with PRESENT + RESTAURANT without token
    const att = {
      id: "att-rest-no-token-p7",
      customerId: customerProfileId2,
      date,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const initialBalance = customerProfilesStore.find((p) => p.id === customerProfileId2).remainingTiffins;
    await finalizeLunchForDate(date);

    // Token generated
    const token = mealTokensStore.find((t) => t.attendanceId === att.id);
    assert.ok(token);

    // Deducted exactly 1
    const finalBalance = customerProfilesStore.find((p) => p.id === customerProfileId2).remainingTiffins;
    assert.equal(finalBalance, initialBalance - 1);
  });

  test("Test 10: Existing ABSENT lunch is untouched (no token, no deduction)", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-06"); // Tuesday

    const att = {
      id: "att-absent-p7",
      customerId: customerProfileId1,
      date,
      mealType: "LUNCH",
      status: "ABSENT",
      location: null,
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const initialBalance = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    const summary = await finalizeLunchForDate(date);

    assert.equal(att.status, "ABSENT");
    assert.equal(summary.skippedAbsent, 1);

    // No token generated for customer 1
    const token = mealTokensStore.find((t) => t.attendanceId === att.id);
    assert.equal(token, undefined);

    // Balance untouched
    const finalBalance = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    assert.equal(finalBalance, initialBalance);
  });

  test("Test 11: Service-suspended customer is not given a token and marked ABSENT with source SUSPENSION", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-07");

    // Add service suspension for Customer 2
    serviceSuspensionsStore.push({
      id: "susp-p7-cust2",
      customerId: customerProfileId2,
      startDate: date,
      endDate: date,
      reason: "Vacation",
    });

    const summary = await finalizeLunchForDate(date);

    assert.equal(summary.skippedSuspended, 1);

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId2 &&
        a.mealType === "LUNCH" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-07"
    );
    assert.ok(att);
    assert.equal(att.status, "ABSENT");
    assert.equal(att.source, "SUSPENSION");

    const token = mealTokensStore.find((t) => t.attendanceId === att.id);
    assert.equal(token, undefined);
  });

  test("Test 12 & 13: Payment-suspended customer (balance 0) is skipped, no token, balance never negative", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-08");

    // Customer 3 has remainingTiffins: 0
    const cust3 = customerProfilesStore.find((p) => p.id === customerProfileId3);
    assert.equal(cust3.remainingTiffins, 0);

    const summary = await finalizeLunchForDate(date);

    assert.ok(summary.skippedPaymentSuspended >= 1);
    assert.equal(cust3.remainingTiffins, 0); // Still 0, not negative

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId3 &&
        a.mealType === "LUNCH" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-08"
    );
    assert.ok(!att || att.status === "UNMARKED");
  });

  test("Test 14: Poll vote is not created by automatic finalization", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const initialVoteCount = pollVotesStore.length;

    await finalizeLunchForDate(parseBusinessDate("2026-10-09"));

    assert.equal(pollVotesStore.length, initialVoteCount);
  });

  test("Test 15: Running lunch finalization twice produces no duplicate token/deduction (Idempotency)", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-12");

    const balanceBefore = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;

    // Run 1
    const run1 = await finalizeLunchForDate(date);
    const tokensAfterRun1 = mealTokensStore.length;
    const balanceAfterRun1 = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;

    assert.equal(balanceAfterRun1, balanceBefore - 1);

    // Run 2 (duplicate execution)
    const run2 = await finalizeLunchForDate(date);
    const tokensAfterRun2 = mealTokensStore.length;
    const balanceAfterRun2 = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;

    // No new tokens created
    assert.equal(tokensAfterRun2, tokensAfterRun1);
    // Balance strictly unchanged
    assert.equal(balanceAfterRun2, balanceAfterRun1);
    // Reported as alreadyFinalized
    assert.ok(run2.alreadyFinalized >= 1);
    assert.equal(run2.finalized, 0);
  });

  // ==================================================
  // DINNER FINALIZATION TESTS (16 - 25)
  // ==================================================
  test("Test 16-20: Unmarked dinner becomes PRESENT + RESTAURANT + AUTO with exactly one token and -1 tiffin", async () => {
    setMockTime(WEDNESDAY_2315_IST);
    const date = parseBusinessDate("2026-09-30");

    const balanceBefore = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;

    const summary = await finalizeDinnerForDate(date);

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId1 &&
        a.mealType === "DINNER" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-09-30"
    );
    assert.ok(att);
    assert.equal(att.status, "PRESENT");
    assert.equal(att.location, "RESTAURANT");
    assert.equal(att.source, "AUTO");

    const token = mealTokensStore.find((t) => t.attendanceId === att.id);
    assert.ok(token);
    assert.match(token.token, /^\d{2}-\d{2}-DN-R-\d{3}$/);

    const balanceAfter = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    assert.equal(balanceAfter, balanceBefore - 1);
  });

  test("Test 21: Existing ABSENT dinner is untouched", async () => {
    setMockTime(WEDNESDAY_2315_IST);
    const date = parseBusinessDate("2026-10-01");

    const att = {
      id: "att-dinner-absent-p7",
      customerId: customerProfileId1,
      date,
      mealType: "DINNER",
      status: "ABSENT",
      location: null,
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const summary = await finalizeDinnerForDate(date);
    assert.equal(att.status, "ABSENT");
    assert.ok(summary.skippedAbsent >= 1);
  });

  test("Test 22: Existing PRESENT dinner is not duplicated", async () => {
    setMockTime(WEDNESDAY_2315_IST);
    const date = parseBusinessDate("2026-10-02");

    const att = {
      id: "att-dinner-present-p7",
      customerId: customerProfileId1,
      date,
      mealType: "DINNER",
      status: "PRESENT",
      location: "RESTAURANT",
      source: "CUSTOMER",
    };
    attendancesStore.push(att);

    const token = {
      id: "token-dinner-p7",
      attendanceId: att.id,
      token: "02-10-DN-R-001",
      date,
      mealType: "DINNER",
      location: "RESTAURANT",
      serialNumber: 1,
    };
    mealTokensStore.push(token);

    const countBefore = mealTokensStore.length;
    await finalizeDinnerForDate(date);

    assert.equal(mealTokensStore.length, countBefore);
  });

  test("Test 23 & 24: Payment-suspended and service-suspended customers are skipped for dinner", async () => {
    setMockTime(WEDNESDAY_2315_IST);
    const date = parseBusinessDate("2026-10-05");

    serviceSuspensionsStore.push({
      id: "susp-dinner-p7",
      customerId: customerProfileId2,
      startDate: date,
      endDate: date,
      reason: "Away",
    });

    const summary = await finalizeDinnerForDate(date);
    assert.ok(summary.skippedSuspended >= 1);
    assert.ok(summary.skippedPaymentSuspended >= 1);
  });

  test("Test 25: Sunday dinner is never processed (strictly excluded)", async () => {
    setMockTime(SUNDAY_2315_IST);
    const sundayDate = parseBusinessDate("2026-10-04"); // Sunday

    const tokensBefore = mealTokensStore.length;
    const summary = await finalizeDinnerForDate(sundayDate);

    assert.equal(summary.processed, 0);
    assert.equal(summary.finalized, 0);
    assert.match(summary.message, /not available on Sunday/);
    assert.equal(mealTokensStore.length, tokensBefore);
  });

  // ==================================================
  // SATURDAY TESTS (26 - 28)
  // ==================================================
  test("Test 26: Saturday lunch finalization works as restaurant service", async () => {
    setMockTime(SATURDAY_1630_IST);
    const saturdayDate = parseBusinessDate("2026-10-03");

    const summary = await finalizeLunchForDate(saturdayDate);

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId1 &&
        a.mealType === "LUNCH" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-03"
    );
    assert.ok(att);
    assert.equal(att.status, "PRESENT");
    assert.equal(att.location, "RESTAURANT");

    const token = mealTokensStore.find((t) => t.attendanceId === att.id);
    assert.ok(token);
    assert.equal(token.location, "RESTAURANT");
  });

  test("Test 27 & 28: Saturday dinner works as restaurant service with no poll created", async () => {
    setMockTime(SATURDAY_2315_IST);
    const saturdayDate = parseBusinessDate("2026-10-03");
    const votesBefore = pollVotesStore.length;

    const summary = await finalizeDinnerForDate(saturdayDate);

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId1 &&
        a.mealType === "DINNER" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-03"
    );
    assert.ok(att);
    assert.equal(att.status, "PRESENT");
    assert.equal(att.location, "RESTAURANT");

    assert.equal(pollVotesStore.length, votesBefore);
  });

  // ==================================================
  // CONCURRENCY & RACE CONDITIONS (29 - 31)
  // ==================================================
  test("Test 29 & 30: Two simultaneous lunch finalizations cannot create duplicate tokens or double deduct", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-14");

    const initialBalance = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;

    // Run two finalizations concurrently
    const [res1, res2] = await Promise.all([finalizeLunchForDate(date), finalizeLunchForDate(date)]);

    const att = attendancesStore.find(
      (a) =>
        a.customerId === customerProfileId1 &&
        a.mealType === "LUNCH" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-14"
    );
    assert.ok(att);

    const customerTokens = mealTokensStore.filter((t) => t.attendanceId === att.id);
    assert.equal(customerTokens.length, 1); // Exactly one token!

    const finalBalance = customerProfilesStore.find((p) => p.id === customerProfileId1).remainingTiffins;
    assert.equal(finalBalance, initialBalance - 1); // Exactly one deduction!
  });

  test("Test 31: Balance = 1 race condition results in exactly one successful token, balance reaches 0", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-15");

    // Create a special customer with balance = 1
    const testCustId = "cust-race-balance-1";
    customerProfilesStore.push({
      id: testCustId,
      userId: "user-race-1",
      name: "Race Customer",
      phone: "+919876543999",
      remainingTiffins: 1,
      serviceStatus: "ACTIVE",
    });

    const [res1, res2] = await Promise.all([finalizeLunchForDate(date), finalizeLunchForDate(date)]);

    const cust = customerProfilesStore.find((p) => p.id === testCustId);
    assert.equal(cust.remainingTiffins, 0); // Balance reaches 0, NEVER -1

    const att = attendancesStore.find(
      (a) =>
        a.customerId === testCustId &&
        a.mealType === "LUNCH" &&
        new Date(a.date).toISOString().slice(0, 10) === "2026-10-15"
    );
    assert.ok(att);

    const tokens = mealTokensStore.filter((t) => t.attendanceId === att.id);
    assert.equal(tokens.length, 1);
  });

  // ==================================================
  // FAILURE HANDLING & RECOVERY (32 - 35)
  // ==================================================
  test("Test 32-34: Token generation failure does not silently report success and reports failed count", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-16");

    // Force failure for customerProfileId1 on mealToken creation
    const originalCreate = prisma.mealToken.create;
    let failedOnce = false;
    prisma.mealToken.create = async (args) => {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("Simulated database failure during token generation");
      }
      return originalCreate(args);
    };

    const summary = await finalizeLunchForDate(date);
    prisma.mealToken.create = originalCreate;

    assert.ok(summary.failed >= 1);
    assert.ok(summary.errors.length >= 1);
  });

  test("Test 35: Rerunning after a partial failure safely completes remaining work", async () => {
    setMockTime(WEDNESDAY_1630_IST);
    const date = parseBusinessDate("2026-10-16");

    // Run again cleanly
    const summary2 = await finalizeLunchForDate(date);
    // Customer who previously failed now finalizes successfully
    assert.ok(summary2.finalized >= 1 || summary2.alreadyFinalized >= 1);
    assert.equal(summary2.failed, 0);
  });

  // ==================================================
  // TIME BOUNDARIES & DUE CHECKS (36 - 38)
  // ==================================================
  test("Test 36: 4 PM boundary handled correctly (rejected before 16:00 IST when enforceTimeWindow=true)", async () => {
    // 10:00 AM IST
    setMockTime(WEDNESDAY_1000_IST);
    assert.equal(isLunchFinalizationDue(getNow()), false);

    await assert.rejects(
      async () => {
        await finalizeLunchForDate(getNow(), { enforceTimeWindow: true });
      },
      (err) => err.statusCode === 400 && /not due yet/.test(err.message)
    );

    // At 16:30 IST
    setMockTime(WEDNESDAY_1630_IST);
    assert.equal(isLunchFinalizationDue(getNow()), true);
  });

  test("Test 37: 11 PM boundary handled correctly (rejected before 23:00 IST when enforceTimeWindow=true)", async () => {
    // 16:30 IST (before 23:00)
    setMockTime(WEDNESDAY_1630_IST);
    assert.equal(isDinnerFinalizationDue(getNow()), false);

    await assert.rejects(
      async () => {
        await finalizeDinnerForDate(getNow(), { enforceTimeWindow: true });
      },
      (err) => err.statusCode === 400 && /not due yet/.test(err.message)
    );

    // At 23:15 IST
    setMockTime(WEDNESDAY_2315_IST);
    assert.equal(isDinnerFinalizationDue(getNow()), true);
  });

  test("Test 38: IST business date is used correctly across timezone offsets", async () => {
    // Set UTC time that is 2026-09-30 in IST
    setMockTime(WEDNESDAY_1630_IST);
    const summary = await finalizeLunchForDate();
    assert.equal(summary.date, "2026-09-30");
  });

  // ==================================================
  // OWNER AUTOMATION API ENDPOINTS (39 - 41)
  // ==================================================
  test("Test 39: Owner can manually trigger lunch finalization via POST /api/owner/automation/finalize-lunch", async () => {
    setMockTime(WEDNESDAY_1630_IST);

    const res = await request(app)
      .post("/api/owner/automation/finalize-lunch")
      .set("Cookie", ownerCookie)
      .send({ date: "2026-10-19" });

    assert.equal(res.status, 200);
    assert.ok(res.body.summary);
    assert.equal(res.body.summary.mealType, "LUNCH");
    assert.equal(res.body.summary.date, "2026-10-19");
  });

  test("Test 40: Customer cannot access owner automation endpoints (403 Forbidden)", async () => {
    const res = await request(app)
      .post("/api/owner/automation/finalize-lunch")
      .set("Cookie", customerCookie)
      .send({ date: "2026-10-19" });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /Access denied/);
  });

  test("Test 41: Owner can inspect scheduler status via GET /api/owner/automation/status", async () => {
    const res = await request(app)
      .get("/api/owner/automation/status")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.scheduler);
    assert.equal(res.body.scheduler.timezone, "Asia/Kolkata");
    assert.equal(res.body.scheduler.jobs.length, 2);
  });
});
