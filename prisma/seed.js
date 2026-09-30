/**
 * ============================================================================
 * DEVELOPMENT SEED DATA ONLY - SWAYAMSIDDHA TIFFIN MANAGEMENT SYSTEM
 * ============================================================================
 * 
 * WARNING:
 * This script is strictly intended for local development and schema verification.
 * DO NOT execute or use this script in production environments.
 * DO NOT hardcode production credentials or sensitive keys here.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

// Helper to hash passwords using sha256 for development seed purposes only
function hashDevPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function main() {
  console.log("🌱 Starting development database seeding...");

  // Load passwords from environment variables with safe dev fallbacks
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || "dev_owner_password_123";
  const customerPassword = process.env.SEED_CUSTOMER_PASSWORD || "dev_customer_password_123";

  // 1. Create Development OWNER User
  console.log("Creating development OWNER user...");
  const ownerUser = await prisma.user.upsert({
    where: { loginIdentifier: "owner@swayamsiddha.local" },
    update: {},
    create: {
      role: "OWNER",
      loginIdentifier: "owner@swayamsiddha.local",
      passwordHash: hashDevPassword(ownerPassword),
    },
  });

  // 2. Create Development CUSTOMER User & CustomerProfile
  console.log("Creating development CUSTOMER user and profile...");
  const customerUser = await prisma.user.upsert({
    where: { loginIdentifier: "customer@swayamsiddha.local" },
    update: {
      customerProfile: {
        update: {
          remainingTiffins: 55,
        },
      },
    },
    create: {
      role: "CUSTOMER",
      loginIdentifier: "customer@swayamsiddha.local",
      passwordHash: hashDevPassword(customerPassword),
      customerProfile: {
        create: {
          name: "Dev Test Customer",
          phone: "+919876543210",
          profilePictureUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
          remainingTiffins: 55, // 56 initial balance - 1 lunch token = 55 remaining tiffins
          serviceStatus: "ACTIVE",
          joinDate: new Date("2026-09-01"),
        },
      },
    },
    include: {
      customerProfile: true,
    },
  });

  const customerProfile = customerUser.customerProfile;

  // 3. Create Initial Balance Ledger Entry
  console.log("Creating initial balance ledger entry...");
  await prisma.tiffinTransaction.create({
    data: {
      customerId: customerProfile.id,
      quantity: 56,
      type: "INITIAL_BALANCE",
      reason: "Initial tiffin package allocation (56 tiffins)",
      createdBy: ownerUser.id,
      createdAt: new Date("2026-09-01T10:00:00.000Z"),
    },
  });

  // 4. Create Lunch Poll for Today (Simulated 2026-09-30)
  const todayDate = new Date("2026-09-30");
  console.log("Creating Lunch poll for date: 2026-09-30...");
  const poll = await prisma.poll.upsert({
    where: {
      date_mealType: {
        date: todayDate,
        mealType: "LUNCH",
      },
    },
    update: {},
    create: {
      date: todayDate,
      mealType: "LUNCH",
      opensAt: new Date("2026-09-30T06:00:00.000Z"),
      closesAt: new Date("2026-09-30T11:30:00.000Z"),
      status: "OPEN",
    },
  });

  // 5. Create Poll Vote for Customer
  console.log("Recording poll vote...");
  await prisma.pollVote.upsert({
    where: {
      pollId_customerId: {
        pollId: poll.id,
        customerId: customerProfile.id,
      },
    },
    update: {},
    create: {
      pollId: poll.id,
      customerId: customerProfile.id,
      option: "COLLEGE",
      votedAt: new Date("2026-09-30T08:15:00.000Z"),
    },
  });

  // 6. Create Attendance for Lunch (PRESENT + COLLEGE)
  console.log("Creating Lunch Attendance, Meal Counter, Meal Token, and Transaction...");
  const lunchAttendance = await prisma.attendance.upsert({
    where: {
      customerId_date_mealType: {
        customerId: customerProfile.id,
        date: todayDate,
        mealType: "LUNCH",
      },
    },
    update: {},
    create: {
      customerId: customerProfile.id,
      date: todayDate,
      mealType: "LUNCH",
      status: "PRESENT",
      location: "COLLEGE",
      source: "CUSTOMER",
      markedAt: new Date("2026-09-30T08:15:00.000Z"),
    },
  });

  // 7. Update MealCounter for Lunch College
  await prisma.mealCounter.upsert({
    where: {
      date_mealType_location: {
        date: todayDate,
        mealType: "LUNCH",
        location: "COLLEGE",
      },
    },
    update: {
      nextSerial: 2,
    },
    create: {
      date: todayDate,
      mealType: "LUNCH",
      location: "COLLEGE",
      nextSerial: 2,
    },
  });

  // 8. Generate Meal Token for Lunch: 30-09-01-C-001
  const lunchToken = await prisma.mealToken.upsert({
    where: {
      attendanceId: lunchAttendance.id,
    },
    update: {},
    create: {
      attendanceId: lunchAttendance.id,
      token: "30-09-01-C-001",
      date: todayDate,
      mealType: "LUNCH",
      location: "COLLEGE",
      serialNumber: 1,
      createdAt: new Date("2026-09-30T08:15:05.000Z"),
    },
  });

  // 9. Record Lunch Tiffin Transaction Deduction (-1)
  await prisma.tiffinTransaction.create({
    data: {
      customerId: customerProfile.id,
      quantity: -1,
      type: "MEAL_TOKEN",
      reason: `Lunch token issued: ${lunchToken.token}`,
      attendanceId: lunchAttendance.id,
      createdBy: null, // Automatic system deduction
      createdAt: new Date("2026-09-30T08:15:05.000Z"),
    },
  });

  // 10. Create Customer Message
  console.log("Creating sample customer message...");
  await prisma.message.create({
    data: {
      customerId: customerProfile.id,
      message: "Hello, please add extra salad if possible today. Thank you!",
      status: "UNREAD",
    },
  });

  // 11. Create Audit Log for Owner Customer Creation
  console.log("Recording initial audit log...");
  await prisma.auditLog.create({
    data: {
      actorId: ownerUser.id,
      action: "OWNER_CREATED_CUSTOMER",
      entityType: "CustomerProfile",
      entityId: customerProfile.id,
      metadata: {
        customerName: customerProfile.name,
        phone: customerProfile.phone,
        initialTiffins: 56,
      },
    },
  });

  // 12. Verification: Check that ledger total equals customerProfile.remainingTiffins
  console.log("Validating ledger balance consistency...");
  const ledgerTransactions = await prisma.tiffinTransaction.findMany({
    where: { customerId: customerProfile.id },
  });
  const ledgerSum = ledgerTransactions.reduce((acc, tx) => acc + tx.quantity, 0);

  const freshProfile = await prisma.customerProfile.findUnique({
    where: { id: customerProfile.id },
  });

  console.log(`Calculated ledger total: ${ledgerSum}`);
  console.log(`Customer profile remainingTiffins: ${freshProfile.remainingTiffins}`);

  if (ledgerSum !== freshProfile.remainingTiffins) {
    throw new Error(
      `Ledger balance mismatch! Calculated ledger: ${ledgerSum}, customer remainingTiffins: ${freshProfile.remainingTiffins}`
    );
  }

  console.log(`✅ Ledger verification passed: ${ledgerSum} == ${freshProfile.remainingTiffins} remaining tiffins.`);
  console.log("✅ Development seed finished successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error running development seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
