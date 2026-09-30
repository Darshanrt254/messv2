import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import {
  setMockTime,
  resetMockTime,
  parseBusinessDate,
  getBusinessDate,
  getNow,
} from "../src/utils/businessTime.js";
import * as analyticsService from "../src/services/analyticsService.js";

describe("Phase 9: Owner Operational XLSX Export API Tests", () => {
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

  // Mutation spies to guarantee READ-ONLY execution
  let mutationsCalled = {
    customerUpdate: 0,
    attendanceUpdate: 0,
    attendanceCreate: 0,
    tokenCreate: 0,
    transactionCreate: 0,
  };

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;

  const ownerUserId = "owner-uuid-p9";
  const customerUserId = "cust-user-p9";

  const custA_id = "cust-a-p9";
  const custB_id = "cust-b-p9";
  const custC_id = "cust-c-p9";
  const custD_id = "cust-d-p9";
  const custE_id = "cust-e-p9";

  // Wednesday 2026-09-30
  const WEDNESDAY_1200_IST = "2026-09-30T06:30:00.000Z";
  const WEDNESDAY_DATE = parseBusinessDate("2026-09-30");

  // Sunday 2026-10-04
  const SUNDAY_DATE = parseBusinessDate("2026-10-04");

  // Saturday 2026-10-03
  const SATURDAY_DATE = parseBusinessDate("2026-10-03");

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

    const profileCreatedTime = new Date("2026-09-01T04:00:00.000Z");

    customerProfilesStore = [
      {
        id: custA_id,
        userId: customerUserId,
        name: "Alice Sharma",
        phone: "9876543210",
        remainingTiffins: 25,
        createdAt: profileCreatedTime,
      },
      {
        id: custB_id,
        userId: "user-b-p9",
        name: "Bob Patil",
        phone: "9876543211",
        remainingTiffins: 10,
        createdAt: profileCreatedTime,
      },
      {
        id: custC_id,
        userId: "user-c-p9",
        name: "Charlie Deshmukh",
        phone: "9876543212",
        remainingTiffins: 5,
        createdAt: profileCreatedTime,
      },
      {
        id: custD_id,
        userId: "user-d-p9",
        name: "Diana Joshi",
        phone: "9876543213",
        remainingTiffins: 20,
        createdAt: profileCreatedTime,
      },
      {
        id: custE_id,
        userId: "user-e-p9",
        name: "Evan Kulkarni",
        phone: "9876543214",
        remainingTiffins: 0, // Payment suspended
        createdAt: profileCreatedTime,
      },
    ];

    // Service Suspensions: Diana suspended on 2026-09-30
    serviceSuspensionsStore = [
      {
        id: "susp-diana-p9",
        customerId: custD_id,
        startDate: WEDNESDAY_DATE,
        endDate: WEDNESDAY_DATE,
        reason: "Vacation",
        active: true,
      },
    ];

    // Attendances for Wednesday 2026-09-30
    attendancesStore = [
      {
        id: "att-a-lunch",
        customerId: custA_id,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "RESTAURANT",
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T03:00:00.000Z"),
        updatedAt: new Date("2026-09-30T03:00:00.000Z"),
      },
      {
        id: "att-a-dinner",
        customerId: custA_id,
        date: WEDNESDAY_DATE,
        mealType: "DINNER",
        status: "PRESENT",
        location: "RESTAURANT",
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T13:00:00.000Z"),
        updatedAt: new Date("2026-09-30T13:00:00.000Z"),
      },
      {
        id: "att-b-lunch",
        customerId: custB_id,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        status: "PRESENT",
        location: "COLLEGE",
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T03:30:00.000Z"),
        updatedAt: new Date("2026-09-30T03:30:00.000Z"),
      },
      {
        id: "att-c-lunch",
        customerId: custC_id,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        status: "ABSENT",
        location: null,
        source: "CUSTOMER",
        createdAt: new Date("2026-09-30T04:00:00.000Z"),
        updatedAt: new Date("2026-09-30T04:00:00.000Z"),
      },
    ];

    // Meal Tokens
    mealTokensStore = [
      {
        id: "tok-1",
        token: "30-09-LU-R-001",
        attendanceId: "att-a-lunch",
        customerId: custA_id,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        location: "RESTAURANT",
        createdAt: new Date("2026-09-30T03:05:00.000Z"),
      },
      {
        id: "tok-2",
        token: "30-09-DN-R-001",
        attendanceId: "att-a-dinner",
        customerId: custA_id,
        date: WEDNESDAY_DATE,
        mealType: "DINNER",
        location: "RESTAURANT",
        createdAt: new Date("2026-09-30T13:05:00.000Z"),
      },
      {
        id: "tok-3",
        token: "30-09-LU-C-001",
        attendanceId: "att-b-lunch",
        customerId: custB_id,
        date: WEDNESDAY_DATE,
        mealType: "LUNCH",
        location: "COLLEGE",
        createdAt: new Date("2026-09-30T03:35:00.000Z"),
      },
    ];

    // Tiffin Transactions (timestamp: 2026-09-30 08:00 IST = 02:30 UTC)
    const txTime = new Date("2026-09-30T02:30:00.000Z");
    tiffinTransactionsStore = [
      {
        id: "tx-init-a",
        customerId: custA_id,
        type: "INITIAL_BALANCE",
        quantity: 56,
        reference: "Opening account balance",
        createdAt: txTime,
      },
      {
        id: "tx-rech-b",
        customerId: custB_id,
        type: "CASH_RECHARGE",
        quantity: 30,
        reference: "Cash payment",
        createdAt: txTime,
      },
      {
        id: "tx-tok-a1",
        customerId: custA_id,
        type: "MEAL_TOKEN",
        quantity: -1,
        reference: "Meal token 30-09-LU-R-001",
        createdAt: txTime,
      },
      {
        id: "tx-tok-a2",
        customerId: custA_id,
        type: "MEAL_TOKEN",
        quantity: -1,
        reference: "Meal token 30-09-DN-R-001",
        createdAt: txTime,
      },
      {
        id: "tx-adj-c",
        customerId: custC_id,
        type: "ADJUSTMENT",
        quantity: 2,
        reference: "Admin correction",
        createdAt: txTime,
      },
    ];

    // Polls & Votes
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
      {
        pollId,
        customerId: custB_id,
        location: "COLLEGE",
        createdAt: new Date("2026-09-30T02:00:00.000Z"),
        poll: pollsStore[0],
      },
      {
        pollId,
        customerId: custA_id,
        location: "RESTAURANT",
        createdAt: new Date("2026-09-30T02:15:00.000Z"),
        poll: pollsStore[0],
      },
    ];

    // Messages
    messagesStore = [
      {
        id: "msg-1",
        customerId: custA_id,
        content: "Need lunch delivered earlier today",
        status: "UNREAD",
        createdAt: txTime,
        readAt: null,
        resolvedAt: null,
      },
      {
        id: "msg-2",
        customerId: custB_id,
        content: "Address update query",
        status: "READ",
        createdAt: txTime,
        readAt: txTime,
        resolvedAt: null,
      },
      {
        id: "msg-3",
        customerId: custC_id,
        content: "Payment verification question",
        status: "RESOLVED",
        createdAt: txTime,
        readAt: txTime,
        resolvedAt: txTime,
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

    // Prisma findMany & counts for export and analytics
    prisma.customerProfile = {
      count: async ({ where } = {}) => {
        let list = [...customerProfilesStore];
        if (where?.remainingTiffins?.lte !== undefined) {
          list = list.filter((p) => p.remainingTiffins <= where.remainingTiffins.lte);
        }
        return list.length;
      },
      findMany: async ({ where, include } = {}) => {
        let list = [...customerProfilesStore];
        if (where?.createdAt?.gte && where?.createdAt?.lt) {
          list = list.filter((c) => c.createdAt >= where.createdAt.gte && c.createdAt < where.createdAt.lt);
        }
        return list.map((c) => {
          const res = { ...c };
          if (include?.serviceSuspensions) {
            res.serviceSuspensions = serviceSuspensionsStore.filter(
              (s) =>
                s.customerId === c.id &&
                (!include.serviceSuspensions.where?.startDate?.lte ||
                  s.startDate <= include.serviceSuspensions.where.startDate.lte) &&
                (!include.serviceSuspensions.where?.endDate?.gte ||
                  s.endDate >= include.serviceSuspensions.where.endDate.gte)
            );
          }
          return res;
        });
      },
      update: async () => {
        mutationsCalled.customerUpdate++;
        return {};
      },
    };

    prisma.attendance = {
      findMany: async ({ where, include } = {}) => {
        let list = [...attendancesStore];
        if (where?.date?.gte && where?.date?.lte) {
          const startStr = new Date(where.date.gte).toISOString().slice(0, 10);
          const endStr = new Date(where.date.lte).toISOString().slice(0, 10);
          list = list.filter((a) => {
            const d = new Date(a.date).toISOString().slice(0, 10);
            return d >= startStr && d <= endStr;
          });
        } else if (where?.date) {
          const target = new Date(where.date).toISOString().slice(0, 10);
          list = list.filter((a) => new Date(a.date).toISOString().slice(0, 10) === target);
        }

        return list.map((a) => {
          const res = { ...a };
          if (include?.customer) {
            res.customer = customerProfilesStore.find((c) => c.id === a.customerId) || null;
          }
          if (include?.mealToken) {
            res.mealToken = mealTokensStore.find((t) => t.attendanceId === a.id) || null;
          }
          return res;
        });
      },
      update: async () => {
        mutationsCalled.attendanceUpdate++;
        return {};
      },
      create: async () => {
        mutationsCalled.attendanceCreate++;
        return {};
      },
    };

    prisma.tiffinTransaction = {
      findMany: async ({ where, include } = {}) => {
        let list = [...tiffinTransactionsStore];
        if (where?.createdAt?.gte && where?.createdAt?.lt) {
          list = list.filter((tx) => tx.createdAt >= where.createdAt.gte && tx.createdAt < where.createdAt.lt);
        }
        return list.map((tx) => {
          const res = { ...tx };
          if (include?.customer) {
            res.customer = customerProfilesStore.find((c) => c.id === tx.customerId) || null;
          }
          return res;
        });
      },
      create: async () => {
        mutationsCalled.transactionCreate++;
        return {};
      },
    };

    prisma.pollVote = {
      findMany: async ({ where, include } = {}) => {
        let list = [...pollVotesStore];
        if (where?.poll?.date?.gte && where?.poll?.date?.lte) {
          const startStr = new Date(where.poll.date.gte).toISOString().slice(0, 10);
          const endStr = new Date(where.poll.date.lte).toISOString().slice(0, 10);
          list = list.filter((v) => {
            const d = new Date(v.poll.date).toISOString().slice(0, 10);
            return d >= startStr && d <= endStr;
          });
        }
        return list.map((v) => {
          const res = { ...v };
          if (include?.customer) {
            res.customer = customerProfilesStore.find((c) => c.id === v.customerId) || null;
          }
          return res;
        });
      },
    };

    prisma.poll = {
      findUnique: async ({ where }) => {
        if (where.date_mealType) {
          const target = new Date(where.date_mealType.date).toISOString().slice(0, 10);
          const p = pollsStore.find(
            (poll) =>
              new Date(poll.date).toISOString().slice(0, 10) === target &&
              poll.mealType === where.date_mealType.mealType
          );
          if (!p) return null;
          return {
            ...p,
            votes: pollVotesStore.filter((v) => v.pollId === p.id),
          };
        }
        return null;
      },
    };

    prisma.message = {
      findMany: async ({ where, include } = {}) => {
        let list = [...messagesStore];
        if (where?.createdAt?.gte && where?.createdAt?.lt) {
          list = list.filter((m) => m.createdAt >= where.createdAt.gte && m.createdAt < where.createdAt.lt);
        }
        return list.map((m) => {
          const res = { ...m };
          if (include?.customer) {
            res.customer = customerProfilesStore.find((c) => c.id === m.customerId) || null;
          }
          return res;
        });
      },
    };

    prisma.mealToken = {
      findMany: async ({ where, include } = {}) => {
        let list = [...mealTokensStore];
        if (where?.date?.gte && where?.date?.lte) {
          const startStr = new Date(where.date.gte).toISOString().slice(0, 10);
          const endStr = new Date(where.date.lte).toISOString().slice(0, 10);
          list = list.filter((t) => {
            const d = new Date(t.date).toISOString().slice(0, 10);
            return d >= startStr && d <= endStr;
          });
        }
        return list.map((t) => {
          const res = { ...t };
          if (include?.attendance) {
            const att = attendancesStore.find((a) => a.id === t.attendanceId);
            res.attendance = {
              ...att,
              customer: att
                ? customerProfilesStore.find((c) => c.id === att.customerId) || null
                : null,
            };
          }
          return res;
        });
      },
      create: async () => {
        mutationsCalled.tokenCreate++;
        return {};
      },
    };

    prisma.serviceSuspension = {
      findMany: async ({ where } = {}) => {
        let list = [...serviceSuspensionsStore];
        if (where?.startDate?.lte && where?.endDate?.gte) {
          list = list.filter(
            (s) => s.startDate <= where.startDate.lte && s.endDate >= where.endDate.gte
          );
        }
        return list;
      },
    };

    // Authenticate owner & customer
    const ownerLoginRes = await request(app).post("/api/auth/login").send({
      loginIdentifier: "owner@swayamsiddha.local",
      password: OWNER_PASSWORD,
    });
    ownerCookie = ownerLoginRes.headers["set-cookie"]?.[0]?.split(";")[0];

    const customerLoginRes = await request(app).post("/api/auth/login").send({
      loginIdentifier: "customer@swayamsiddha.local",
      password: CUSTOMER_PASSWORD,
    });
    customerCookie = customerLoginRes.headers["set-cookie"]?.[0]?.split(";")[0];
  });

  afterEach(() => {
    resetMockTime();
  });

  /**
   * Helper to download binary XLSX buffer and inspect response
   */
  async function fetchXlsx(url, cookie = ownerCookie) {
    const req = request(app).get(url);
    if (cookie) req.set("Cookie", cookie);
    return req.buffer(true).parse((res, callback) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  }

  // =========================================================================
  // 1-3. AUTHORIZATION TESTS
  // =========================================================================
  test("1. Owner can download XLSX (200 OK)", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers["content-type"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.match(res.headers["content-disposition"], /attachment; filename="swayamsiddha-report-2026-09-30-to-2026-09-30\.xlsx"/);
    assert.ok(Buffer.isBuffer(res.body));
    assert.ok(res.body.length > 0);
  });

  test("2. Unauthenticated user receives 401 Unauthorized", async () => {
    const res = await request(app).get("/api/owner/exports/xlsx");
    assert.equal(res.status, 401);
  });

  test("3. Customer receives 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/owner/exports/xlsx")
      .set("Cookie", customerCookie);
    assert.equal(res.status, 403);
  });

  // =========================================================================
  // 4-8. DATE RANGE & VALIDATION TESTS
  // =========================================================================
  test("4. Valid from/to range works properly", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-01&to=2026-09-30", ownerCookie);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /2026-09-01-to-2026-09-30/);
  });

  test("5. Default date range works (defaults to today's business date)", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx", ownerCookie);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /2026-09-30-to-2026-09-30/);
  });

  test("6. Invalid date format rejected (400 Bad Request)", async () => {
    const res = await request(app)
      .get("/api/owner/exports/xlsx?from=invalid-date")
      .set("Cookie", ownerCookie);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid 'from' date format/);
  });

  test("7. Impossible calendar date rejected (400 Bad Request)", async () => {
    const res = await request(app)
      .get("/api/owner/exports/xlsx?from=2026-02-31")
      .set("Cookie", ownerCookie);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid 'from' date format/);
  });

  test("8. Inverted range (from > to) rejected (400 Bad Request)", async () => {
    const res = await request(app)
      .get("/api/owner/exports/xlsx?from=2026-10-05&to=2026-10-01")
      .set("Cookie", ownerCookie);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /must be on or before/);
  });

  // =========================================================================
  // 9. EMPTY RANGE HANDLING
  // =========================================================================
  test("9. Empty range still returns valid XLSX with all 7 required sheets and headers", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    // Future range with no records
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-12-01&to=2026-12-02", ownerCookie);
    assert.equal(res.status, 200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheetNames = workbook.worksheets.map((w) => w.name);
    assert.deepEqual(sheetNames, [
      "Attendance",
      "Customers",
      "Tiffin Transactions",
      "Poll Results",
      "Messages",
      "Meal Tokens",
      "Daily Summary",
    ]);

    // Check that every sheet has headers in Row 1
    for (const sheet of workbook.worksheets) {
      assert.ok(sheet.getRow(1).cellCount > 0, `Sheet ${sheet.name} must have a header row`);
    }
  });

  // =========================================================================
  // 10-16. SHEET CONTENT & CORRECTNESS TESTS
  // =========================================================================
  test("10. Attendance data appears accurately in Attendance sheet", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Attendance");
    assert.ok(sheet);

    // Row 1: Header. Rows 2-5: 4 attendance records (Alice lunch, Alice dinner, Bob lunch, Charlie lunch)
    assert.equal(sheet.rowCount, 5);

    // Verify Bob's College lunch record
    let foundBob = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(2).value === "Bob Patil") {
        foundBob = true;
        assert.equal(row.getCell(4).value, "Lunch");
        assert.equal(row.getCell(5).value, "Present");
        assert.equal(row.getCell(6).value, "College");
        assert.equal(row.getCell(8).value, "30-09-LU-C-001"); // Token included
      }
    });
    assert.ok(foundBob, "Bob Patil attendance record must be present");
  });

  test("11. Customer data appears in Customers sheet with accurate suspension and payment status", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Customers");
    assert.ok(sheet);

    // 5 customers + header = 6 rows
    assert.equal(sheet.rowCount, 6);

    let dianaRow = null;
    let evanRow = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        if (row.getCell(2).value === "Diana Joshi") dianaRow = row;
        if (row.getCell(2).value === "Evan Kulkarni") evanRow = row;
      }
    });

    assert.ok(dianaRow, "Diana Joshi should be in customer sheet");
    assert.equal(dianaRow.getCell(5).value, "SERVICE_SUSPENDED");

    assert.ok(evanRow, "Evan Kulkarni should be in customer sheet");
    assert.equal(evanRow.getCell(4).value, 0); // remainingTiffins
    assert.equal(evanRow.getCell(6).value, "PAYMENT_SUSPENDED");
    assert.equal(evanRow.getCell(7).value, "PAYMENT_SUSPENDED");
  });

  test("12. Tiffin ledger appears in Tiffin Transactions sheet with preserved signs", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Tiffin Transactions");
    assert.ok(sheet);

    // 5 transactions + 1 header = 6 rows
    assert.equal(sheet.rowCount, 6);

    let foundInitial = false;
    let foundMealToken = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const type = row.getCell(5).value;
        const qty = row.getCell(6).value;
        const signedQty = row.getCell(7).value;

        if (type === "INITIAL_BALANCE") {
          foundInitial = true;
          assert.equal(qty, 56);
          assert.equal(signedQty, 56);
        }
        if (type === "MEAL_TOKEN") {
          foundMealToken = true;
          assert.equal(qty, 1); // absolute positive
          assert.equal(signedQty, -1); // signed negative
        }
      }
    });

    assert.ok(foundInitial, "INITIAL_BALANCE transaction must exist with positive sign");
    assert.ok(foundMealToken, "MEAL_TOKEN transaction must exist with -1 signed quantity");
  });

  test("13. Poll votes appear only when actual votes exist in Poll Results sheet", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Poll Results");
    assert.ok(sheet);

    // 2 votes + 1 header = 3 rows
    assert.equal(sheet.rowCount, 3);

    const votes = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        votes.push({
          customer: row.getCell(4).value,
          vote: row.getCell(6).value,
        });
      }
    });

    assert.equal(votes.length, 2);
    assert.ok(votes.some((v) => v.customer === "Bob Patil" && v.vote === "College"));
    assert.ok(votes.some((v) => v.customer === "Alice Sharma" && v.vote === "Restaurant"));
  });

  test("14. Customer messages appear correctly in Messages sheet", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Messages");
    assert.ok(sheet);

    // 3 messages + 1 header = 4 rows
    assert.equal(sheet.rowCount, 4);

    const statuses = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        statuses.push(row.getCell(5).value);
      }
    });

    assert.ok(statuses.includes("UNREAD"));
    assert.ok(statuses.includes("READ"));
    assert.ok(statuses.includes("RESOLVED"));
  });

  test("15. Meal tokens appear accurately in Meal Tokens sheet", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Meal Tokens");
    assert.ok(sheet);

    // 3 tokens + 1 header = 4 rows
    assert.equal(sheet.rowCount, 4);

    const tokens = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        tokens.push(row.getCell(1).value);
      }
    });

    assert.ok(tokens.includes("30-09-LU-R-001"));
    assert.ok(tokens.includes("30-09-DN-R-001"));
    assert.ok(tokens.includes("30-09-LU-C-001"));
  });

  test("16. Daily Summary sheet is generated with accurate daily aggregates and Total row", async () => {
    setMockTime(WEDNESDAY_1200_IST);
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Daily Summary");
    assert.ok(sheet);

    // Row 1: Header, Row 2: 2026-09-30, Row 3: TOTAL
    assert.equal(sheet.rowCount, 3);

    const dayRow = sheet.getRow(2);
    assert.equal(dayRow.getCell(1).value, "2026-09-30");
    assert.equal(dayRow.getCell(2).value, "Wednesday");
    assert.equal(dayRow.getCell(3).value, 2); // Lunch present: Alice, Bob
    assert.equal(dayRow.getCell(4).value, 1); // Lunch absent: Charlie
    assert.equal(dayRow.getCell(5).value, 1); // Dinner present: Alice
    assert.equal(dayRow.getCell(6).value, 0); // Dinner absent: 0
    assert.equal(dayRow.getCell(7).value, 1); // Lunch Restaurant: Alice
    assert.equal(dayRow.getCell(8).value, 1); // Lunch College: Bob
    assert.equal(dayRow.getCell(9).value, 1); // Dinner Restaurant: Alice
    assert.equal(dayRow.getCell(10).value, 3); // Meals Consumed: 3 tokens
    assert.equal(dayRow.getCell(11).value, 86); // Tiffins Added: 56 + 30
    assert.equal(dayRow.getCell(12).value, 2); // Tiffins Consumed: 2 tokens deducted
    assert.equal(dayRow.getCell(13).value, 86); // Net Tiffin Change: 56 + 30 - 1 - 1 + 2 = 86
    assert.equal(dayRow.getCell(14).value, 2); // Poll Votes: 2
    assert.equal(dayRow.getCell(15).value, 3); // Messages: 3

    // Verify Total Row
    const totalRow = sheet.getRow(3);
    assert.equal(totalRow.getCell(1).value, "TOTAL");
    assert.equal(totalRow.getCell(3).value, 2);
    assert.equal(totalRow.getCell(10).value, 3);
  });

  // =========================================================================
  // 17-18. WEEKEND BUSINESS RULES ENFORCEMENT
  // =========================================================================
  test("17. Sunday dinner is never fabricated in export Daily Summary", async () => {
    // 2026-10-04 is a Sunday
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-10-04&to=2026-10-04", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Daily Summary");
    const sundayRow = sheet.getRow(2);
    assert.equal(sundayRow.getCell(1).value, "2026-10-04");
    assert.equal(sundayRow.getCell(2).value, "Sunday");
    assert.equal(sundayRow.getCell(5).value, 0); // Dinner present must be strictly 0
    assert.equal(sundayRow.getCell(6).value, 0); // Dinner absent must be strictly 0
    assert.equal(sundayRow.getCell(9).value, 0); // Dinner restaurant must be strictly 0
  });

  test("18. Saturday lunch poll is never fabricated in export Daily Summary", async () => {
    // 2026-10-03 is a Saturday
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-10-03&to=2026-10-03", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Daily Summary");
    const saturdayRow = sheet.getRow(2);
    assert.equal(saturdayRow.getCell(1).value, "2026-10-03");
    assert.equal(saturdayRow.getCell(2).value, "Saturday");
    assert.equal(saturdayRow.getCell(14).value, 0); // Poll votes must be strictly 0
  });

  // =========================================================================
  // 19-22. STRICT READ-ONLY INTEGRITY TESTS
  // =========================================================================
  test("19. Export does not modify customer balances (CustomerProfile.remainingTiffins)", async () => {
    const balancesBefore = customerProfilesStore.map((c) => c.remainingTiffins);
    await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const balancesAfter = customerProfilesStore.map((c) => c.remainingTiffins);
    assert.deepEqual(balancesBefore, balancesAfter);
    assert.equal(mutationsCalled.customerUpdate, 0);
  });

  test("20. Export does not generate new MealTokens", async () => {
    const countBefore = mealTokensStore.length;
    await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    assert.equal(mealTokensStore.length, countBefore);
    assert.equal(mutationsCalled.tokenCreate, 0);
  });

  test("21. Export does not create or modify Attendance records", async () => {
    const countBefore = attendancesStore.length;
    await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    assert.equal(attendancesStore.length, countBefore);
    assert.equal(mutationsCalled.attendanceCreate, 0);
    assert.equal(mutationsCalled.attendanceUpdate, 0);
  });

  test("22. Export does not create TiffinTransaction records", async () => {
    const countBefore = tiffinTransactionsStore.length;
    await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    assert.equal(tiffinTransactionsStore.length, countBefore);
    assert.equal(mutationsCalled.transactionCreate, 0);
  });

  // =========================================================================
  // 23-24. SECURITY & CREDENTIAL HYGIENE TESTS
  // =========================================================================
  test("23. Password hashes and credentials are never present anywhere in the workbook", async () => {
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const val = String(cell.value || "");
          assert.equal(val.includes(OWNER_PASSWORD), false, "Password must not appear in spreadsheet");
          assert.equal(val.includes(CUSTOMER_PASSWORD), false, "Password must not appear in spreadsheet");
          assert.equal(val.includes("$2a$"), false, "Bcrypt hash must not appear in spreadsheet");
          assert.equal(val.includes("$2b$"), false, "Bcrypt hash must not appear in spreadsheet");
        });
      });
    }
  });

  test("24. Session and authentication secrets are never present in workbook", async () => {
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const val = String(cell.value || "");
          assert.equal(val.includes("swayamsiddha_session"), false);
          assert.equal(val.includes("token-"), false);
        });
      });
    }
  });

  // =========================================================================
  // 25-27. MULTI-CUSTOMER, TOKEN FORMAT & CONSISTENCY TESTS
  // =========================================================================
  test("25. Multiple customers are exported correctly with distinct rows", async () => {
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Customers");
    const names = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) names.push(row.getCell(2).value);
    });

    assert.equal(names.length, 5);
    assert.deepEqual(names.sort(), [
      "Alice Sharma",
      "Bob Patil",
      "Charlie Deshmukh",
      "Diana Joshi",
      "Evan Kulkarni",
    ].sort());
  });

  test("26. Token strings use the existing DD-MM-LU/DN-R/C-SSS format", async () => {
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Meal Tokens");
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const token = row.getCell(1).value;
        assert.match(token, /^\d{2}-\d{2}-(LU|DN)-(R|C)-\d{3}$/);
      }
    });
  });

  test("27. Phase 8 analytics numbers and export summary remain consistent for the same fixture", async () => {
    setMockTime(WEDNESDAY_1200_IST);

    // Call Phase 8 analytics directly
    const analytics = await analyticsService.getDailyOperationalSummary({ date: "2026-09-30" });

    // Call Phase 9 export
    const res = await fetchXlsx("/api/owner/exports/xlsx?from=2026-09-30&to=2026-09-30", ownerCookie);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet("Daily Summary");
    const row = sheet.getRow(2);

    // Assert exact consistency between Phase 8 analytics and Phase 9 export
    assert.equal(row.getCell(3).value, analytics.lunch.present);
    assert.equal(row.getCell(4).value, analytics.lunch.absent);
    assert.equal(row.getCell(5).value, analytics.dinner.present);
    assert.equal(row.getCell(6).value, analytics.dinner.absent);
    assert.equal(row.getCell(7).value, analytics.lunch.restaurant);
    assert.equal(row.getCell(8).value, analytics.lunch.college);
    assert.equal(row.getCell(9).value, analytics.dinner.restaurant);
    assert.equal(row.getCell(10).value, analytics.tiffinsConsumed);
    assert.equal(row.getCell(14).value, analytics.poll.votes);
  });
});
