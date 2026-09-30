import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import env from "../src/config/env.js";

describe("Phase 3: Customer Profile & Owner Customer Management API Tests", () => {
  // In-memory test store mirroring PostgreSQL database
  let usersStore = [];
  let customerProfilesStore = [];
  let tiffinTransactionsStore = [];
  let auditLogsStore = [];
  let sessionsStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  let seededCustomerId = "customer-profile-uuid-1";

  before(async () => {
    // Generate bcrypt hashes for seed accounts
    const ownerHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    const customerHash = await bcrypt.hash(CUSTOMER_PASSWORD, 10);

    const initialUsers = [
      {
        id: "owner-uuid-1",
        loginIdentifier: "owner@swayamsiddha.local",
        role: "OWNER",
        passwordHash: ownerHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "customer-uuid-2",
        loginIdentifier: "customer@swayamsiddha.local",
        role: "CUSTOMER",
        passwordHash: customerHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const initialProfiles = [
      {
        id: seededCustomerId,
        userId: "customer-uuid-2",
        name: "Dev Test Customer",
        phone: "+919876543210",
        profilePictureUrl: "https://example.com/pic.jpg",
        remainingTiffins: 55,
        serviceStatus: "ACTIVE",
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const initialTransactions = [
      {
        id: "tx-1",
        customerId: seededCustomerId,
        quantity: 56,
        type: "INITIAL_BALANCE",
        reason: "Initial allocation",
        createdBy: "owner-uuid-1",
        createdAt: new Date(),
      },
      {
        id: "tx-2",
        customerId: seededCustomerId,
        quantity: -1,
        type: "MEAL_TOKEN",
        reason: "Lunch token",
        createdBy: null,
        createdAt: new Date(),
      },
    ];

    // Reset stores
    usersStore = [...initialUsers];
    customerProfilesStore = [...initialProfiles];
    tiffinTransactionsStore = [...initialTransactions];
    auditLogsStore = [];
    sessionsStore = [];

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

    prisma.user.create = async ({ data }) => {
      const newUser = {
        id: `user-${Date.now()}-${Math.random()}`,
        role: data.role,
        loginIdentifier: data.loginIdentifier,
        passwordHash: data.passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      usersStore.push(newUser);
      return newUser;
    };

    prisma.customerProfile.findUnique = async ({ where, include }) => {
      let profile = null;
      if (where.id) {
        profile = customerProfilesStore.find((p) => p.id === where.id);
      } else if (where.userId) {
        profile = customerProfilesStore.find((p) => p.userId === where.userId);
      } else if (where.phone) {
        profile = customerProfilesStore.find((p) => p.phone === where.phone);
      }

      if (!profile) return null;

      if (include && include.user) {
        const user = usersStore.find((u) => u.id === profile.userId);
        return {
          ...profile,
          user: user
            ? {
                id: user.id,
                loginIdentifier: user.loginIdentifier,
                role: user.role,
                createdAt: user.createdAt,
              }
            : null,
        };
      }
      return profile;
    };

    prisma.customerProfile.findMany = async ({ where, skip = 0, take = 20 }) => {
      let filtered = [...customerProfilesStore];
      if (where && where.OR) {
        // Simple search filter simulation
        const term = where.OR[0]?.name?.contains?.toLowerCase() || "";
        filtered = filtered.filter((p) => {
          const u = usersStore.find((user) => user.id === p.userId);
          return (
            p.name.toLowerCase().includes(term) ||
            p.phone.toLowerCase().includes(term) ||
            (u && u.loginIdentifier.toLowerCase().includes(term))
          );
        });
      }

      const paged = filtered.slice(skip, skip + take);
      return paged.map((p) => {
        const user = usersStore.find((u) => u.id === p.userId);
        return {
          ...p,
          user: user
            ? {
                id: user.id,
                loginIdentifier: user.loginIdentifier,
                role: user.role,
                createdAt: user.createdAt,
              }
            : null,
        };
      });
    };

    prisma.customerProfile.count = async () => customerProfilesStore.length;

    prisma.customerProfile.create = async ({ data }) => {
      const newProfile = {
        id: `cust-${Date.now()}-${Math.random()}`,
        userId: data.userId,
        name: data.name,
        phone: data.phone,
        profilePictureUrl: data.profilePictureUrl || null,
        remainingTiffins: data.remainingTiffins ?? 56,
        serviceStatus: data.serviceStatus || "ACTIVE",
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      customerProfilesStore.push(newProfile);
      return newProfile;
    };

    prisma.customerProfile.update = async ({ where, data, include }) => {
      const index = customerProfilesStore.findIndex((p) => p.id === where.id);
      if (index === -1) throw new Error("Not found");

      customerProfilesStore[index] = {
        ...customerProfilesStore[index],
        ...data,
        updatedAt: new Date(),
      };

      const updated = customerProfilesStore[index];
      if (include && include.user) {
        const user = usersStore.find((u) => u.id === updated.userId);
        return {
          ...updated,
          user: user
            ? {
                id: user.id,
                loginIdentifier: user.loginIdentifier,
                role: user.role,
                createdAt: user.createdAt,
              }
            : null,
        };
      }
      return updated;
    };

    prisma.tiffinTransaction.create = async ({ data }) => {
      const tx = {
        id: `tx-${Date.now()}-${Math.random()}`,
        customerId: data.customerId,
        quantity: data.quantity,
        type: data.type,
        reason: data.reason || null,
        createdBy: data.createdBy || null,
        createdAt: new Date(),
      };
      tiffinTransactionsStore.push(tx);
      return tx;
    };

    prisma.tiffinTransaction.findMany = async ({ where }) => {
      if (where && where.customerId) {
        return tiffinTransactionsStore.filter((t) => t.customerId === where.customerId);
      }
      return tiffinTransactionsStore;
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
        user: {
          ...user,
          customerProfile,
        },
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

  // A. CUSTOMER /me
  test("Test A: CUSTOMER GET /api/customer/me returns 200 with customer's own safe profile", async () => {
    const res = await request(app)
      .get("/api/customer/me")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.customer);
    assert.equal(res.body.customer.customerProfileId, seededCustomerId);
    assert.equal(res.body.customer.name, "Dev Test Customer");
    assert.equal(res.body.customer.phone, "+919876543210");
    assert.equal(res.body.customer.remainingTiffins, 55);
    assert.equal(res.body.customer.serviceStatus, "ACTIVE");
    assert.equal(res.body.customer.passwordHash, undefined, "passwordHash must not be exposed");
  });

  // B. OWNER customer list
  test("Test B: OWNER GET /api/owner/customers returns 200 with paginated customer list", async () => {
    const res = await request(app)
      .get("/api/owner/customers")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.customers));
    assert.ok(res.body.pagination);
    assert.equal(res.body.customers.length >= 1, true);
    assert.equal(res.body.customers[0].name, "Dev Test Customer");
    assert.equal(res.body.customers[0].passwordHash, undefined);
  });

  // C. OWNER customer detail
  test("Test C: OWNER GET /api/owner/customers/:customerId returns 200 with customer detail", async () => {
    const res = await request(app)
      .get(`/api/owner/customers/${seededCustomerId}`)
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.customer);
    assert.equal(res.body.customer.id, seededCustomerId);
    assert.equal(res.body.customer.name, "Dev Test Customer");
    assert.equal(res.body.customer.passwordHash, undefined);
  });

  // D. CUSTOMER cannot access owner list
  test("Test D: CUSTOMER GET /api/owner/customers returns 403 Forbidden", async () => {
    const res = await request(app)
      .get("/api/owner/customers")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 403);
    assert.match(res.body.error, /access denied/i);
  });

  // E. CUSTOMER cannot access owner detail
  test("Test E: CUSTOMER GET /api/owner/customers/:customerId returns 403 Forbidden", async () => {
    const res = await request(app)
      .get(`/api/owner/customers/${seededCustomerId}`)
      .set("Cookie", customerCookie);

    assert.equal(res.status, 403);
    assert.match(res.body.error, /access denied/i);
  });

  // F. CUSTOMER cannot create customer
  test("Test F: CUSTOMER POST /api/owner/customers returns 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/owner/customers")
      .set("Cookie", customerCookie)
      .send({
        name: "Unauthorized Customer",
        phone: "+919999999999",
        loginIdentifier: "unauth@swayamsiddha.local",
        password: "password123",
      });

    assert.equal(res.status, 403);
  });

  // G. OWNER creates customer
  let newlyCreatedCustomerId = null;
  test("Test G: OWNER POST /api/owner/customers creates User, Profile, INITIAL_BALANCE transaction, AuditLog and returns 201", async () => {
    const initialTiffins = 40;
    const res = await request(app)
      .post("/api/owner/customers")
      .set("Cookie", ownerCookie)
      .send({
        name: "Aman Sharma",
        phone: "+919811122233",
        loginIdentifier: "aman@swayamsiddha.local",
        password: "secure_password_123",
        initialTiffins,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.message, "Customer created successfully");
    assert.ok(res.body.customer);
    assert.equal(res.body.customer.name, "Aman Sharma");
    assert.equal(res.body.customer.phone, "+919811122233");
    assert.equal(res.body.customer.remainingTiffins, initialTiffins);
    assert.equal(res.body.customer.serviceStatus, "ACTIVE");
    assert.equal(res.body.customer.user.loginIdentifier, "aman@swayamsiddha.local");
    assert.equal(res.body.customer.user.role, "CUSTOMER");
    assert.equal(res.body.customer.passwordHash, undefined);

    newlyCreatedCustomerId = res.body.customer.id;

    // Verify initial ledger transaction was created
    const transactions = tiffinTransactionsStore.filter((t) => t.customerId === newlyCreatedCustomerId);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].quantity, initialTiffins);
    assert.equal(transactions[0].type, "INITIAL_BALANCE");

    // Verify AuditLog was recorded
    const auditLog = auditLogsStore.find(
      (a) => a.action === "OWNER_CREATED_CUSTOMER" && a.entityId === newlyCreatedCustomerId
    );
    assert.ok(auditLog, "Audit log must be created for customer creation");
  });

  // H. Duplicate loginIdentifier
  test("Test H: POST /api/owner/customers with duplicate loginIdentifier returns 409 Conflict", async () => {
    const res = await request(app)
      .post("/api/owner/customers")
      .set("Cookie", ownerCookie)
      .send({
        name: "Duplicate User",
        phone: "+919888877777",
        loginIdentifier: "aman@swayamsiddha.local", // Already used in Test G
        password: "password123",
      });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /login identifier already exists/i);
  });

  // I. Duplicate phone
  test("Test I: POST /api/owner/customers with duplicate phone returns 409 Conflict", async () => {
    const res = await request(app)
      .post("/api/owner/customers")
      .set("Cookie", ownerCookie)
      .send({
        name: "Duplicate Phone Customer",
        phone: "+919811122233", // Already used in Test G
        loginIdentifier: "new_unique_login@swayamsiddha.local",
        password: "password123",
      });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /phone number already exists/i);
  });

  // J. Invalid initial balance (Negative balance)
  test("Test J: POST /api/owner/customers with negative initial balance returns 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/owner/customers")
      .set("Cookie", ownerCookie)
      .send({
        name: "Invalid Balance Customer",
        phone: "+919777766666",
        loginIdentifier: "invalid_balance@swayamsiddha.local",
        password: "password123",
        initialTiffins: -10,
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /non-negative/i);
  });

  // K. OWNER updates customer
  test("Test K: OWNER PATCH /api/owner/customers/:customerId updates basic profile information and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/owner/customers/${newlyCreatedCustomerId}`)
      .set("Cookie", ownerCookie)
      .send({
        name: "Aman Sharma Updated",
        phone: "+919811122299",
        profilePictureUrl: "https://example.com/aman.png",
        // The following fields should be ignored and disallowed:
        remainingTiffins: 999,
        serviceStatus: "SERVICE_SUSPENDED",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.customer.name, "Aman Sharma Updated");
    assert.equal(res.body.customer.phone, "+919811122299");
    assert.equal(res.body.customer.profilePictureUrl, "https://example.com/aman.png");
    // Verify restricted fields were not modified
    assert.equal(res.body.customer.remainingTiffins, 40, "remainingTiffins must not be modified via profile PATCH");
    assert.equal(res.body.customer.serviceStatus, "ACTIVE", "serviceStatus must not be modified via profile PATCH");

    // Verify audit log
    const updateAudit = auditLogsStore.find(
      (a) => a.action === "OWNER_UPDATED_CUSTOMER" && a.entityId === newlyCreatedCustomerId
    );
    assert.ok(updateAudit, "Audit log must be created for customer update");
  });

  // L. CUSTOMER cannot update customer
  test("Test L: CUSTOMER PATCH /api/owner/customers/:customerId returns 403 Forbidden", async () => {
    const res = await request(app)
      .patch(`/api/owner/customers/${newlyCreatedCustomerId}`)
      .set("Cookie", customerCookie)
      .send({
        name: "Hacker Attempt",
      });

    assert.equal(res.status, 403);
  });

  // M. Non-existent customer
  test("Test M: OWNER GET /api/owner/customers/nonexistent returns 404 Not Found", async () => {
    const res = await request(app)
      .get("/api/owner/customers/non-existent-customer-id")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 404);
    assert.match(res.body.error, /not found/i);
  });

  // N. Ledger consistency
  test("Test N: Newly created customer ledger sum strictly equals remainingTiffins", async () => {
    const profile = customerProfilesStore.find((p) => p.id === newlyCreatedCustomerId);
    assert.ok(profile);

    const transactions = tiffinTransactionsStore.filter((t) => t.customerId === newlyCreatedCustomerId);
    const ledgerSum = transactions.reduce((sum, tx) => sum + tx.quantity, 0);

    assert.equal(ledgerSum, profile.remainingTiffins);
    assert.equal(ledgerSum, 40);
  });
});
