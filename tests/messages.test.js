import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";

describe("Phase 6: Customer & Owner Message Workflow Tests", () => {
  let usersStore = [];
  let customerProfilesStore = [];
  let sessionsStore = [];
  let messagesStore = [];
  let auditLogsStore = [];

  const OWNER_PASSWORD = "dev_owner_password_123";
  const CUSTOMER_PASSWORD = "dev_customer_password_123";

  let ownerCookie = null;
  let customerCookie = null;
  const ownerUserId = "owner-uuid-msg";
  const customerUserId = "customer-uuid-msg";
  const customerProfileId = "cust-profile-uuid-msg";

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
        name: "Message Test Customer",
        phone: "+919876543211",
        remainingTiffins: 15,
        serviceStatus: "ACTIVE",
      },
    ];

    prisma.$transaction = async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        return callbackOrArray(prisma);
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

    prisma.message = {
      create: async ({ data }) => {
        const item = {
          id: `msg-${Date.now()}-${Math.random()}`,
          ...data,
          createdAt: new Date(),
          readAt: null,
          resolvedAt: null,
        };
        messagesStore.push(item);
        return item;
      },
      findMany: async ({ where, skip, take, include }) => {
        let results = [...messagesStore];
        if (where?.customerId) results = results.filter((m) => m.customerId === where.customerId);
        if (where?.status) results = results.filter((m) => m.status === where.status);
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        }
        return results.map((m) => {
          const cloned = { ...m };
          if (include?.customer) {
            cloned.customer = customerProfilesStore.find((p) => p.id === cloned.customerId) || null;
          }
          return cloned;
        });
      },
      count: async ({ where }) => {
        let results = [...messagesStore];
        if (where?.customerId) results = results.filter((m) => m.customerId === where.customerId);
        if (where?.status) results = results.filter((m) => m.status === where.status);
        return results.length;
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

    prisma.auditLog = {
      create: async ({ data }) => {
        const item = { id: `audit-${Date.now()}`, ...data, createdAt: new Date() };
        auditLogsStore.push(item);
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

    // Log in OWNER and CUSTOMER
    const ownerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "owner@swayamsiddha.local", password: OWNER_PASSWORD });
    ownerCookie = ownerRes.headers["set-cookie"]?.[0];

    const customerRes = await request(app)
      .post("/api/auth/login")
      .send({ loginIdentifier: "customer@swayamsiddha.local", password: CUSTOMER_PASSWORD });
    customerCookie = customerRes.headers["set-cookie"]?.[0];
  });

  let createdMessageId = null;

  // 1. Customer can create message
  test("Test 1: Customer can send a message/query to owner", async () => {
    const res = await request(app)
      .post("/api/customer/messages")
      .set("Cookie", customerCookie)
      .send({ message: "Hello, please hold my tiffin for tomorrow lunch." });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, "UNREAD");
    assert.equal(res.body.data.customerId, customerProfileId);
    assert.ok(res.body.data.id);
    createdMessageId = res.body.data.id;
  });

  // 2. Empty message rejected
  test("Test 2: Empty message is rejected (400 Bad Request)", async () => {
    const res = await request(app)
      .post("/api/customer/messages")
      .set("Cookie", customerCookie)
      .send({ message: "   " });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /cannot be empty/);
  });

  // 3. Customer can list their own messages
  test("Test 3: Customer can retrieve their own messages", async () => {
    const res = await request(app)
      .get("/api/customer/messages")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages[0].id, createdMessageId);
  });

  // 4. Owner can list all customer messages
  test("Test 4: Owner can list all customer messages with customer details", async () => {
    const res = await request(app)
      .get("/api/owner/messages")
      .set("Cookie", ownerCookie);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.messages));
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages[0].status, "UNREAD");
  });

  // 5. Customer cannot access owner message list (403)
  test("Test 5: Customer cannot access owner message list (403 Forbidden)", async () => {
    const res = await request(app)
      .get("/api/owner/messages")
      .set("Cookie", customerCookie);

    assert.equal(res.status, 403);
  });

  // 6. Owner marks message as READ
  test("Test 6: Owner marks message status as READ", async () => {
    const res = await request(app)
      .patch(`/api/owner/messages/${createdMessageId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "READ" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "READ");
    assert.ok(res.body.data.readAt);

    // Verify AuditLog
    const audit = auditLogsStore.find((a) => a.action === "OWNER_UPDATED_MESSAGE");
    assert.ok(audit);
  });

  // 7. Customer cannot update/resolve message (403)
  test("Test 7: Customer cannot resolve or update message (403 Forbidden)", async () => {
    const res = await request(app)
      .patch(`/api/owner/messages/${createdMessageId}`)
      .set("Cookie", customerCookie)
      .send({ status: "RESOLVED" });

    assert.equal(res.status, 403);
  });

  // 8. Owner resolves message
  test("Test 8: Owner resolves message and sets resolvedAt timestamp", async () => {
    const res = await request(app)
      .patch(`/api/owner/messages/${createdMessageId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "RESOLVED" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "RESOLVED");
    assert.ok(res.body.data.resolvedAt);
  });

  // 9. Modifying already RESOLVED message is rejected
  test("Test 9: Attempting to modify an already RESOLVED message is rejected (400 Bad Request)", async () => {
    const res = await request(app)
      .patch(`/api/owner/messages/${createdMessageId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "READ" });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already resolved/);
  });
});
