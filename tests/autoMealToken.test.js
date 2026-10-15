import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { setMockTime, resetMockTime, parseBusinessDate } from "../src/utils/businessTime.js";

describe("Automatic Meal Token Generation Rules", () => {
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let pollsStore = [];
  let pollVotesStore = [];
  let auditLogsStore = [];
  let mealTokensStore = [];
  let mealCountersStore = [];
  let tiffinTransactionsStore = [];

  const CUSTOMER_PASSWORD = "dev_customer_password_auto";
  let customerCookie = null;
  const customerUserId = "customer-uuid-auto";
  const customerProfileId = "cust-profile-auto";

  // Weekday Wednesday:
  // 08:30 IST (Poll is OPEN, between 06:00 and 11:30 IST) = 03:00 UTC
  const WEDNESDAY_POLL_OPEN = "2026-09-30T03:00:00.000Z";
  // 05:00 IST (Poll is NOT open yet, before 06:00 IST) = 2026-09-29 23:30 UTC
  const WEDNESDAY_POLL_EARLY = "2026-09-29T23:30:00.000Z";
  // 12:00 IST (Poll is CLOSED, after 11:30 IST) = 06:30 UTC
  const WEDNESDAY_POLL_CLOSED = "2026-09-30T06:30:00.000Z";

  // Saturday (No poll for lunch, weekend):
  const SATURDAY_1000_IST = "2026-10-03T04:30:00.000Z";

  before(async () => {
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    usersStore = [
      {
        id: customerUserId,
        loginIdentifier: "autocustomer@swayamsiddha.local",
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
        name: "Auto Token Customer",
        phone: "+919876543210",
        profilePictureUrl: null,
        remainingTiffins: 20,
        serviceStatus: "ACTIVE",
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Mock Prisma transactions and methods
    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        return callbackOrArray(prisma);
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

    prisma.customerProfile.findUnique = async ({ where }) => {
      if (where.id) return customerProfilesStore.find((p) => p.id === where.id) || null;
      if (where.userId) return customerProfilesStore.find((p) => p.userId === where.userId) || null;
      return null;
    };

    prisma.customerProfile.updateMany = async ({ where, data }) => {
      const p = customerProfilesStore.find((c) => c.id === where.id);
      if (p && p.remainingTiffins > 0) {
        if (data.remainingTiffins?.decrement) {
          p.remainingTiffins -= data.remainingTiffins.decrement;
        }
        return { count: 1 };
      }
      return { count: 0 };
    };

    prisma.serviceSuspension = {
      findFirst: async () => null,
      findMany: async () => [],
    };

    prisma.session.create = async ({ data }) => {
      const session = {
        id: `sess-${Date.now()}-${Math.random()}`,
        userId: data.userId,
        token: data.token,
        expiresAt: data.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sessionsStore.push(session);
      return session;
    };

    prisma.session.findUnique = async ({ where }) => {
      const sess = sessionsStore.find((s) => s.token === where.token);
      if (!sess) return null;
      const user = usersStore.find((u) => u.id === sess.userId);
      const customerProfile = customerProfilesStore.find((p) => p.userId === sess.userId) || null;
      return {
        ...sess,
        user: { ...user, customerProfile },
      };
    };

    prisma.poll.upsert = async ({ where, update, create }) => {
      const existing = pollsStore.find(
        (p) =>
          p.date.toISOString().split("T")[0] === where.date_mealType.date.toISOString().split("T")[0] &&
          p.mealType === where.date_mealType.mealType
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
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
    };

    prisma.poll.findUnique = async ({ where }) => {
      if (where.id) return pollsStore.find((p) => p.id === where.id) || null;
      if (where.date_mealType) {
        return (
          pollsStore.find(
            (p) =>
              p.date.toISOString().split("T")[0] === where.date_mealType.date.toISOString().split("T")[0] &&
              p.mealType === where.date_mealType.mealType
          ) || null
        );
      }
      return null;
    };

    prisma.pollVote.findUnique = async ({ where }) => {
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
    };

    prisma.pollVote.create = async ({ data }) => {
      const vote = {
        id: `vote-${Date.now()}-${Math.random()}`,
        pollId: data.pollId,
        customerId: data.customerId,
        option: data.option,
        votedAt: data.votedAt || new Date(),
      };
      pollVotesStore.push(vote);
      return vote;
    };

    prisma.attendance.findUnique = async ({ where }) => {
      if (where.id) {
        const att = attendancesStore.find((a) => a.id === where.id);
        if (!att) return null;
        const tok = mealTokensStore.find((m) => m.attendanceId === att.id) || null;
        const cust = customerProfilesStore.find((c) => c.id === att.customerId) || null;
        return { ...att, mealToken: tok, customer: cust };
      }
      if (where.customerId_date_mealType) {
        const att = attendancesStore.find(
          (a) =>
            a.customerId === where.customerId_date_mealType.customerId &&
            a.date.toISOString().split("T")[0] ===
              where.customerId_date_mealType.date.toISOString().split("T")[0] &&
            a.mealType === where.customerId_date_mealType.mealType
        );
        if (!att) return null;
        const tok = mealTokensStore.find((m) => m.attendanceId === att.id) || null;
        const cust = customerProfilesStore.find((c) => c.id === att.customerId) || null;
        return { ...att, mealToken: tok, customer: cust };
      }
      return null;
    };

    prisma.attendance.create = async ({ data }) => {
      const rec = {
        id: `att-${Date.now()}-${Math.random()}`,
        customerId: data.customerId,
        date: data.date,
        mealType: data.mealType,
        status: data.status,
        location: data.location || null,
        source: data.source || "CUSTOMER",
        markedAt: data.markedAt || new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      attendancesStore.push(rec);
      return rec;
    };

    prisma.attendance.update = async ({ where, data }) => {
      const idx = attendancesStore.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error("Attendance not found");
      attendancesStore[idx] = {
        ...attendancesStore[idx],
        ...data,
        updatedAt: new Date(),
      };
      return attendancesStore[idx];
    };

    prisma.counter = {
      findUnique: async () => null,
      upsert: async ({ where, update, create }) => {
        let c = mealCountersStore.find(
          (m) =>
            m.date.toISOString().split("T")[0] === where.date_mealType_location.date.toISOString().split("T")[0] &&
            m.mealType === where.date_mealType_location.mealType &&
            m.location === where.date_mealType_location.location
        );
        if (c) {
          c.count += update.count.increment || 1;
          return c;
        }
        c = {
          id: `ctr-${Date.now()}-${Math.random()}`,
          date: create.date,
          mealType: create.mealType,
          location: create.location,
          count: create.count || 1,
        };
        mealCountersStore.push(c);
        return c;
      },
    };

    prisma.mealToken = {
      findUnique: async ({ where }) => {
        if (where.attendanceId) {
          return mealTokensStore.find((m) => m.attendanceId === where.attendanceId) || null;
        }
        return null;
      },
      create: async ({ data }) => {
        const tok = {
          id: `token-${Date.now()}-${Math.random()}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mealTokensStore.push(tok);
        return tok;
      },
    };

    prisma.tiffinTransaction = {
      create: async ({ data }) => {
        const tx = {
          id: `tx-${Date.now()}-${Math.random()}`,
          ...data,
          createdAt: new Date(),
        };
        tiffinTransactionsStore.push(tx);
        return tx;
      },
    };

    prisma.auditLog = {
      create: async ({ data }) => {
        const log = { id: `audit-${Date.now()}-${Math.random()}`, ...data, createdAt: new Date() };
        auditLogsStore.push(log);
        return log;
      },
    };

    // Login customer
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "autocustomer@swayamsiddha.local",
        password: CUSTOMER_PASSWORD,
      });
    customerCookie = loginRes.headers["set-cookie"];
  });

  beforeEach(() => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];
    mealTokensStore = [];
    mealCountersStore = [];
    tiffinTransactionsStore = [];
    customerProfilesStore[0].remainingTiffins = 20;
  });

  afterEach(() => {
    resetMockTime();
  });

  // Rule 1: Dinner attendance PRESENT directly generates token for RESTAURANT
  test("Rule 1: Marking Dinner PRESENT directly generates RESTAURANT token upon attendance confirmation", async () => {
    setMockTime(WEDNESDAY_POLL_OPEN);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "DINNER", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
    assert.ok(res.body.mealToken, "Meal token should be automatically returned");
    assert.match(res.body.mealToken.token, /30-09-DN-R-\d{3}/);
    assert.equal(customerProfilesStore[0].remainingTiffins, 19, "Exactly 1 tiffin deducted");
  });

  // Rule 2: Lunch attendance PRESENT when poll is NOT live (e.g. Saturday)
  test("Rule 2: Marking Lunch PRESENT on Saturday (no poll) selects RESTAURANT and generates token immediately", async () => {
    setMockTime(SATURDAY_1000_IST);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
    assert.ok(res.body.mealToken, "Meal token should be automatically generated");
    assert.match(res.body.mealToken.token, /03-10-LU-R-\d{3}/);
    assert.equal(customerProfilesStore[0].remainingTiffins, 19);
  });

  // Rule 2b: Lunch attendance PRESENT when poll is NOT live (after 11:30 IST on weekday)
  test("Rule 2b: Marking Lunch PRESENT on Weekday after poll closes (12:00 IST) selects RESTAURANT and generates token immediately", async () => {
    setMockTime(WEDNESDAY_POLL_CLOSED);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
    assert.ok(res.body.mealToken, "Meal token generated for RESTAURANT");
    assert.match(res.body.mealToken.token, /30-09-LU-R-\d{3}/);
    assert.equal(customerProfilesStore[0].remainingTiffins, 19);
  });

  // Rule 3: Lunch attendance PRESENT when poll IS live requires voting at the poll
  test("Rule 3: Marking Lunch PRESENT on Weekday when poll is LIVE (08:30 IST) requires poll vote and does not generate token yet", async () => {
    setMockTime(WEDNESDAY_POLL_OPEN);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, null);
    assert.equal(res.body.requiresPollVote, true, "Should indicate poll vote is required");
    assert.equal(res.body.mealToken, null, "Token should not be generated before voting");
    assert.equal(customerProfilesStore[0].remainingTiffins, 20, "Tiffin not deducted yet");

    // Now student votes in poll for COLLEGE delivery
    const voteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(voteRes.status, 200);
    assert.equal(voteRes.body.result.vote, "COLLEGE");
    assert.equal(voteRes.body.result.attendance.location, "COLLEGE");
    assert.ok(voteRes.body.result.mealToken, "Respective meal token generated upon poll vote");
    assert.match(voteRes.body.result.mealToken.token, /30-09-LU-C-\d{3}/);
    assert.equal(customerProfilesStore[0].remainingTiffins, 19, "Exactly 1 tiffin deducted after voting");
  });

  // Rule 4: Lunch attendance ABSENT does not generate any token
  test("Rule 4: Marking Lunch or Dinner ABSENT does not generate token and does not deduct tiffin", async () => {
    setMockTime(WEDNESDAY_POLL_OPEN);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "ABSENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "ABSENT");
    assert.equal(res.body.attendance.location, null);
    assert.equal(res.body.mealToken, null);
    assert.equal(customerProfilesStore[0].remainingTiffins, 20);
    assert.equal(mealTokensStore.length, 0);
  });
});
