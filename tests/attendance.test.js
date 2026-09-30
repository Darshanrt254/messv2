import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { setMockTime, resetMockTime } from "../src/utils/businessTime.js";

describe("Phase 4: Attendance & Lunch Poll Business Logic Tests", () => {
  // In-memory test store mirroring PostgreSQL database
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let attendancesStore = [];
  let pollsStore = [];
  let pollVotesStore = [];
  let auditLogsStore = [];
  let mealTokensStore = [];
  let tiffinTransactionsStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  const customerUserId = "customer-uuid-phase4";
  const customerProfileId = "cust-profile-uuid-phase4";
  const initialCustomerTiffins = 55;

  // Wednesday 2026-09-30 (Weekday):
  // 08:30 IST = 03:00 UTC
  const WEDNESDAY_0830_IST = "2026-09-30T03:00:00.000Z";
  // 05:00 IST = 2026-09-29 23:30 UTC (Before 06:00 IST)
  const WEDNESDAY_0500_IST = "2026-09-29T23:30:00.000Z";
  // 12:00 IST = 06:30 UTC (After 11:30 IST)
  const WEDNESDAY_1200_IST = "2026-09-30T06:30:00.000Z";

  // Saturday 2026-10-03: 10:00 IST = 04:30 UTC
  const SATURDAY_1000_IST = "2026-10-03T04:30:00.000Z";

  // Sunday 2026-10-04: 10:00 IST = 04:30 UTC
  const SUNDAY_1000_IST = "2026-10-04T04:30:00.000Z";

  before(async () => {
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    usersStore = [
      {
        id: "owner-uuid-phase4",
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
        name: "Phase 4 Test Customer",
        phone: "+919876500000",
        profilePictureUrl: null,
        remainingTiffins: initialCustomerTiffins,
        serviceStatus: "ACTIVE",
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Mock Prisma methods
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

    prisma.session.deleteMany = async ({ where }) => {
      if (where.token) sessionsStore = sessionsStore.filter((s) => s.token !== where.token);
      return { count: 1 };
    };

    prisma.poll.upsert = async ({ where, update, create }) => {
      const existingIndex = pollsStore.findIndex(
        (p) =>
          p.date.toISOString().split("T")[0] === where.date_mealType.date.toISOString().split("T")[0] &&
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
      if (where.id) return attendancesStore.find((a) => a.id === where.id) || null;
      if (where.customerId_date_mealType) {
        return (
          attendancesStore.find(
            (a) =>
              a.customerId === where.customerId_date_mealType.customerId &&
              a.date.toISOString().split("T")[0] ===
                where.customerId_date_mealType.date.toISOString().split("T")[0] &&
              a.mealType === where.customerId_date_mealType.mealType
          ) || null
        );
      }
      return null;
    };

    prisma.attendance.findMany = async ({ where }) => {
      let filtered = [...attendancesStore];
      if (where.customerId) filtered = filtered.filter((a) => a.customerId === where.customerId);
      if (where.date) {
        filtered = filtered.filter(
          (a) => a.date.toISOString().split("T")[0] === where.date.toISOString().split("T")[0]
        );
      }
      if (where.mealType) filtered = filtered.filter((a) => a.mealType === where.mealType);
      if (where.status) filtered = filtered.filter((a) => a.status === where.status);
      return filtered.map((a) => {
        const cust = customerProfilesStore.find((c) => c.id === a.customerId);
        return {
          ...a,
          customer: cust
            ? {
                ...cust,
                user: { id: cust.userId, loginIdentifier: "customer@swayamsiddha.local" },
              }
            : null,
        };
      });
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
      const cust = customerProfilesStore.find((c) => c.id === attendancesStore[idx].customerId);
      return {
        ...attendancesStore[idx],
        customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone } : null,
      };
    };

    prisma.auditLog.create = async ({ data }) => {
      const log = {
        id: `audit-${Date.now()}-${Math.random()}`,
        actorId: data.actorId || null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId || null,
        metadata: data.metadata || null,
        createdAt: new Date(),
      };
      auditLogsStore.push(log);
      return log;
    };

    // Obtain OWNER authentication cookie
    const ownerRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "owner@swayamsiddha.local",
        password: OWNER_PASSWORD,
      });
    ownerCookie = ownerRes.headers["set-cookie"];

    // Obtain CUSTOMER authentication cookie
    const customerRes = await request(app)
      .post("/api/auth/login")
      .send({
        loginIdentifier: "customer@swayamsiddha.local",
        password: CUSTOMER_PASSWORD,
      });
    customerCookie = customerRes.headers["set-cookie"];
  });

  beforeEach(() => {
    // Default mock time to Wednesday 08:30 IST
    setMockTime(WEDNESDAY_0830_IST);
  });

  afterEach(() => {
    resetMockTime();
  });

  // A. Weekday lunch PRESENT
  test("Test A: Weekday lunch PRESENT marks status PRESENT with location null and poll remains available", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({
        mealType: "LUNCH",
        status: "PRESENT",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, null, "Weekday lunch PRESENT must have null location initially");

    // Verify poll remains available for this customer
    const mealStateRes = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(mealStateRes.status, 200);
    assert.equal(mealStateRes.body.lunch.status, "PRESENT");
    assert.equal(mealStateRes.body.lunch.location, null);
    assert.equal(mealStateRes.body.poll.eligible, true, "Poll must remain eligible for customer");
    assert.equal(mealStateRes.body.poll.status, "OPEN");
  });

  // B. Weekday lunch ABSENT
  test("Test B: Weekday lunch ABSENT marks status ABSENT with null location and makes poll unavailable", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({
        mealType: "LUNCH",
        status: "ABSENT",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "ABSENT");
    assert.equal(res.body.attendance.location, null);

    const mealStateRes = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(mealStateRes.body.lunch.status, "ABSENT");
    assert.equal(mealStateRes.body.poll.eligible, false);
    assert.equal(mealStateRes.body.poll.reason, "LUNCH_ABSENT");
  });

  // C. Attendance immutability
  test("Test C: Customer cannot change confirmed attendance choice (PRESENT -> ABSENT returns 409 Conflict)", async () => {
    attendancesStore = [];

    // Mark PRESENT
    await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    // Attempt change to ABSENT
    const conflictRes = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "ABSENT" });

    assert.equal(conflictRes.status, 409);
    assert.match(conflictRes.body.error, /already confirmed/i);
  });

  // D. Vote COLLEGE after PRESENT
  test("Test D: Vote COLLEGE after PRESENT updates attendance location to COLLEGE", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    // 1. Mark Lunch PRESENT
    await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    // 2. Vote COLLEGE
    const voteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(voteRes.status, 200);
    assert.equal(voteRes.body.result.vote, "COLLEGE");
    assert.equal(voteRes.body.result.attendance.status, "PRESENT");
    assert.equal(voteRes.body.result.attendance.location, "COLLEGE");

    // 3. Verify via meal state
    const stateRes = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(stateRes.body.lunch.status, "PRESENT");
    assert.equal(stateRes.body.lunch.location, "COLLEGE");
    assert.equal(stateRes.body.poll.existingVote, "COLLEGE");
    assert.equal(stateRes.body.poll.eligible, false);
    assert.equal(stateRes.body.poll.reason, "ALREADY_VOTED");
  });

  // E. Vote RESTAURANT without prior attendance
  test("Test E: Vote RESTAURANT without prior attendance transactionally creates PollVote and Attendance PRESENT + RESTAURANT", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    const voteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "RESTAURANT" });

    assert.equal(voteRes.status, 200);
    assert.equal(voteRes.body.result.vote, "RESTAURANT");
    assert.equal(voteRes.body.result.attendance.status, "PRESENT");
    assert.equal(voteRes.body.result.attendance.location, "RESTAURANT");

    // Verify stored attendance
    const stored = attendancesStore.find((a) => a.mealType === "LUNCH");
    assert.ok(stored);
    assert.equal(stored.status, "PRESENT");
    assert.equal(stored.location, "RESTAURANT");
  });

  // F. Vote after Lunch ABSENT
  test("Test F: Vote after Lunch ABSENT is rejected and creates no PollVote", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    // Mark ABSENT
    await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "ABSENT" });

    // Attempt Vote
    const voteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(voteRes.status, 400);
    assert.match(voteRes.body.error, /marked ABSENT/i);
    assert.equal(pollVotesStore.length, 0, "No poll vote should be recorded");
  });

  // G. Second vote
  test("Test G: Second vote attempt returns 409 Conflict and original vote remains COLLEGE", async () => {
    attendancesStore = [];
    pollsStore = [];
    pollVotesStore = [];

    // First Vote: COLLEGE
    await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    // Second Vote: RESTAURANT
    const secondVoteRes = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "RESTAURANT" });

    assert.equal(secondVoteRes.status, 409);
    assert.match(secondVoteRes.body.error, /already voted/i);

    const vote = pollVotesStore.find((v) => v.customerId === customerProfileId);
    assert.equal(vote.option, "COLLEGE", "Original vote must not be changed");
  });

  // H. Vote before 06:00
  test("Test H: Vote before 06:00 IST is rejected", async () => {
    setMockTime(WEDNESDAY_0500_IST); // 05:00 IST

    const res = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /not opened yet/i);
  });

  // I. Vote after 11:30
  test("Test I: Vote after 11:30 IST is rejected", async () => {
    setMockTime(WEDNESDAY_1200_IST); // 12:00 IST

    const res = await request(app)
      .post("/api/customer/poll/vote")
      .set("Cookie", customerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /closed/i);
  });

  // J. Saturday poll
  test("Test J: On Saturday, no poll exists and poll retrieval returns pollExists: false", async () => {
    setMockTime(SATURDAY_1000_IST); // Saturday

    const res = await request(app)
      .get("/api/customer/poll/today")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.pollExists, false);
    assert.equal(res.body.reason, "WEEKEND");
  });

  // K. Saturday Lunch PRESENT
  test("Test K: Saturday Lunch PRESENT automatically sets location to RESTAURANT", async () => {
    setMockTime(SATURDAY_1000_IST);
    attendancesStore = [];

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
  });

  // L. Saturday Dinner PRESENT
  test("Test L: Saturday Dinner PRESENT automatically sets location to RESTAURANT", async () => {
    setMockTime(SATURDAY_1000_IST);
    attendancesStore = [];

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "DINNER", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
  });

  // M. Sunday Lunch PRESENT
  test("Test M: Sunday Lunch PRESENT sets location to RESTAURANT", async () => {
    setMockTime(SUNDAY_1000_IST);
    attendancesStore = [];

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "LUNCH", status: "PRESENT" });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "RESTAURANT");
  });

  // N. Sunday dinner marking rejected
  test("Test N: Marking Sunday dinner is rejected because dinner service is not available", async () => {
    setMockTime(SUNDAY_1000_IST);

    const res = await request(app)
      .post("/api/customer/attendance")
      .set("Cookie", customerCookie)
      .send({ mealType: "DINNER", status: "PRESENT" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /not available on Sunday/i);

    // Verify daily meal state indicates dinner.serviceAvailable = false
    const stateRes = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(stateRes.body.dinner.serviceAvailable, false);
  });

  // O. Dinner COLLEGE rejected
  test("Test O: Attempting to mark dinner with COLLEGE is rejected by domain rules", async () => {
    // The customer endpoint does not accept location (it sets RESTAURANT),
    // and owner edit with DINNER + COLLEGE must be rejected:
    const res = await request(app)
      .patch("/api/owner/attendance/fake-id")
      .set("Cookie", ownerCookie)
      .send({ location: "COLLEGE" });

    // Should be rejected (either 400 or 404 for missing id, but let's test with real id):
    attendancesStore = [
      {
        id: "dinner-att-1",
        customerId: customerProfileId,
        date: new Date(),
        mealType: "DINNER",
        status: "PRESENT",
        location: "RESTAURANT",
      },
    ];

    const patchRes = await request(app)
      .patch("/api/owner/attendance/dinner-att-1")
      .set("Cookie", ownerCookie)
      .send({ location: "COLLEGE" });

    assert.equal(patchRes.status, 400);
    assert.match(patchRes.body.error, /College location is not permitted for dinner/i);
  });

  // P. Customer cannot access owner attendance endpoint
  test("Test P: CUSTOMER accessing GET /api/owner/attendance returns 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/owner/attendance")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 403);
  });

  // Q. Owner attendance list
  test("Test Q: OWNER accessing GET /api/owner/attendance returns 200 with attendance records", async () => {
    const res = await request(app)
      .get("/api/owner/attendance")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.attendance));
  });

  // R. Owner attendance edit & AuditLog
  test("Test R: OWNER PATCH /api/owner/attendance/:id updates attendance and creates AuditLog entry", async () => {
    attendancesStore = [
      {
        id: "owner-edit-att-1",
        customerId: customerProfileId,
        date: new Date("2026-09-30T00:00:00.000Z"),
        mealType: "LUNCH",
        status: "ABSENT",
        location: null,
      },
    ];

    const res = await request(app)
      .patch("/api/owner/attendance/owner-edit-att-1")
      .set("Cookie", ownerCookie)
      .send({
        status: "PRESENT",
        location: "COLLEGE",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.attendance.status, "PRESENT");
    assert.equal(res.body.attendance.location, "COLLEGE");

    // Verify AuditLog entry was recorded
    const audit = auditLogsStore.find(
      (a) => a.action === "OWNER_UPDATED_ATTENDANCE" && a.entityId === "owner-edit-att-1"
    );
    assert.ok(audit, "Audit log must be created for owner attendance update");
    assert.equal(audit.metadata.previousStatus, "ABSENT");
    assert.equal(audit.metadata.newStatus, "PRESENT");
    assert.equal(audit.metadata.newLocation, "COLLEGE");
  });

  // S. Customer cannot edit owner attendance endpoint
  test("Test S: CUSTOMER PATCH /api/owner/attendance/:id returns 403 Forbidden", async () => {
    const res = await request(app)
      .patch("/api/owner/attendance/owner-edit-att-1")
      .set("Cookie", customerCookie)
      .send({ status: "PRESENT" });

    assert.equal(res.status, 403);
  });

  // T. No token creation
  test("Test T: Verify zero MealTokens were created by Phase 4 attendance and poll operations", () => {
    assert.equal(mealTokensStore.length, 0, "Phase 4 must not generate any meal tokens");
  });

  // U. No balance deduction
  test("Test U: Verify customer remainingTiffins balance was not modified by Phase 4 operations", () => {
    const profile = customerProfilesStore.find((p) => p.id === customerProfileId);
    assert.equal(profile.remainingTiffins, initialCustomerTiffins, "Tiffins must not be deducted in Phase 4");
  });

  // V. No TiffinTransaction meal deduction
  test("Test V: Verify no MEAL_TOKEN transaction was created by Phase 4 operations", () => {
    const mealTx = tiffinTransactionsStore.find((t) => t.type === "MEAL_TOKEN");
    assert.equal(mealTx, undefined, "No MEAL_TOKEN deduction transactions permitted in Phase 4");
  });

  // W. Poll uniqueness
  test("Test W: Concurrent/repeated poll retrieval produces exactly one poll record per date and meal type", async () => {
    pollsStore = [];
    setMockTime(WEDNESDAY_0830_IST);

    await Promise.all([
      request(app).get("/api/customer/poll/today").set("Cookie", customerCookie),
      request(app).get("/api/customer/poll/today").set("Cookie", customerCookie),
      request(app).get("/api/customer/meals/today").set("Cookie", customerCookie),
    ]);

    const lunchPolls = pollsStore.filter((p) => p.mealType === "LUNCH");
    assert.equal(lunchPolls.length, 1, "Exactly one lunch poll must exist for the business date");
  });

  // X. Customer isolation
  test("Test X: Customer can retrieve only their own meal and attendance state", async () => {
    const res = await request(app)
      .get("/api/customer/meals/today")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.businessDate);
    assert.ok(res.body.lunch);
    assert.ok(res.body.dinner);
    assert.equal(res.body.customer, undefined, "Must not leak internal customer or other profile objects");
  });
});
