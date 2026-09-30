import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import {
  getISTComponents,
  isSaturday,
  isSunday,
} from "../utils/businessTime.js";
import { getCustomerServiceStatus } from "./customerEligibilityService.js";

/**
 * Formats the human-readable meal token string:
 * DD-MM-MEAL-LOCATION-SSS
 *
 * Where:
 * - DD = 2-digit day
 * - MM = 2-digit month
 * - MEAL: LU = Lunch, DN = Dinner
 * - LOCATION: R = Restaurant, C = College
 * - SSS = 3-digit serial number (001, 002, ...)
 */
export function formatTokenString({ date, mealType, location, serialNumber }) {
  const ist = getISTComponents(date);
  const DD = String(ist.day).padStart(2, "0");
  const MM = String(ist.month).padStart(2, "0");
  const MEAL = mealType === "LUNCH" ? "LU" : "DN";
  const LOC = location === "RESTAURANT" ? "R" : "C";
  const SSS = String(serialNumber).padStart(3, "0");

  return `${DD}-${MM}-${MEAL}-${LOC}-${SSS}`;
}

/**
 * Generates a meal token and executes an atomic -1 tiffin deduction.
 *
 * Invariants:
 * 1. A tiffin is deducted EXACTLY ONCE if and only if a MealToken is successfully created.
 * 2. If a MealToken already exists for this attendance, returns the existing token (Idempotent).
 * 3. Remaining tiffins must be > 0 and customer must not be service-suspended.
 * 4. All steps (counter allocation, token creation, ledger entry, balance decrement, audit log) are atomic.
 */
export async function generateMealToken(arg, maybeActorId = null) {
  let attendanceId;
  let actorId = null;

  if (typeof arg === "object" && arg !== null) {
    attendanceId = arg.attendanceId;
    actorId = arg.actorId || maybeActorId;
  } else {
    attendanceId = arg;
    actorId = maybeActorId;
  }

  if (!attendanceId || typeof attendanceId !== "string") {
    throw ApiError.badRequest("Invalid attendance ID.");
  }

  // 1. Fetch Attendance and associated CustomerProfile
  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: {
      customer: true,
      mealToken: true,
    },
  });

  if (!attendance) {
    throw ApiError.notFound(`Attendance record '${attendanceId}' not found.`);
  }

  // 2. Idempotency Check: If MealToken already exists, return existing token without side effects
  if (attendance.mealToken) {
    return {
      ...attendance.mealToken,
      isNew: false,
      mealToken: attendance.mealToken,
    };
  }

  // 3. Status Validation: Must be PRESENT
  if (attendance.status !== "PRESENT") {
    throw ApiError.badRequest(
      `Cannot generate meal token: Attendance status is '${attendance.status}'. Must be 'PRESENT'.`
    );
  }

  // 4. Location Validation: Must not be null
  if (!attendance.location) {
    throw ApiError.badRequest(
      "Cannot generate meal token: Attendance location is pending/null. Location must be chosen first."
    );
  }

  // 5. Weekly Service Rules Validation
  if (attendance.mealType === "DINNER") {
    if (isSunday(attendance.date)) {
      throw ApiError.badRequest("Cannot generate meal token: Dinner service is not available on Sunday.");
    }
    if (attendance.location !== "RESTAURANT") {
      throw ApiError.badRequest("Cannot generate meal token: College location is not permitted for dinner.");
    }
  } else if (attendance.mealType === "LUNCH") {
    if (!["COLLEGE", "RESTAURANT"].includes(attendance.location)) {
      throw ApiError.badRequest("Invalid lunch location.");
    }
    if ((isSaturday(attendance.date) || isSunday(attendance.date)) && attendance.location !== "RESTAURANT") {
      throw ApiError.badRequest("Weekend lunch token can only be issued for RESTAURANT location.");
    }
  }

  // 6. Service & Payment Suspension Check
  const eligibility = await getCustomerServiceStatus(attendance.customerId, attendance.date);
  if (eligibility.isServiceSuspended) {
    throw ApiError.badRequest("Cannot generate meal token: Customer service is suspended for the attendance date.");
  }

  if (eligibility.isPaymentSuspended || attendance.customer.remainingTiffins <= 0) {
    throw ApiError.conflict("Insufficient tiffin balance. Customer has zero remaining tiffins.");
  }

  const ist = getISTComponents(attendance.date);

  try {
    // 7. Atomic Transaction Execution
    const result = await prisma.$transaction(async (tx) => {
      // 7a. Double check if token was generated concurrently
      const existingInTx = await tx.mealToken.findUnique({
        where: { attendanceId },
      });
      if (existingInTx) {
        return {
          ...existingInTx,
          isNew: false,
          mealToken: existingInTx,
        };
      }

      // 7b. Atomic balance decrement with row lock & condition (remainingTiffins > 0)
      const balanceUpdate = await tx.customerProfile.updateMany({
        where: {
          id: attendance.customerId,
          remainingTiffins: { gt: 0 },
        },
        data: {
          remainingTiffins: { decrement: 1 },
        },
      });

      if (balanceUpdate.count === 0) {
        throw ApiError.conflict("Insufficient tiffin balance. Customer has zero remaining tiffins.");
      }

      // 7c. Atomic Counter Allocation per (date + mealType + location)
      const counter = await tx.mealCounter.upsert({
        where: {
          date_mealType_location: {
            date: attendance.date,
            mealType: attendance.mealType,
            location: attendance.location,
          },
        },
        update: {
          nextSerial: { increment: 1 },
        },
        create: {
          date: attendance.date,
          mealType: attendance.mealType,
          location: attendance.location,
          nextSerial: 2,
        },
      });

      const serialNumber = counter.nextSerial - 1;

      // 7d. Construct human-readable token string
      const tokenString = formatTokenString({
        date: attendance.date,
        mealType: attendance.mealType,
        location: attendance.location,
        serialNumber,
      });

      // 7e. Create MealToken record
      const mealToken = await tx.mealToken.create({
        data: {
          attendanceId: attendance.id,
          token: tokenString,
          date: attendance.date,
          mealType: attendance.mealType,
          location: attendance.location,
          serialNumber,
        },
      });

      // 7f. Create MEAL_TOKEN TiffinTransaction (-1)
      await tx.tiffinTransaction.create({
        data: {
          customerId: attendance.customerId,
          quantity: -1,
          type: "MEAL_TOKEN",
          reason: `Meal token issued: ${tokenString}`,
          attendanceId: attendance.id,
          createdBy: actorId || null,
        },
      });

      // 7g. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          actorId: actorId || null,
          action: "MEAL_TOKEN_GENERATED",
          entityType: "MealToken",
          entityId: mealToken.id,
          metadata: {
            actorId: actorId || null,
            customerId: attendance.customerId,
            attendanceId: attendance.id,
            token: tokenString,
            mealType: attendance.mealType,
            location: attendance.location,
            serialNumber,
            businessDate: ist.dateString,
          },
        },
      });

      return {
        ...mealToken,
        isNew: true,
        mealToken,
      };
    });

    return result;
  } catch (error) {
    // Handle unique constraint race condition gracefully on attendanceId
    if (error.code === "P2002" || error.message?.includes("Unique constraint") || error.meta?.target?.includes("attendanceId")) {
      const existingAfterRace = await prisma.mealToken.findUnique({
        where: { attendanceId },
      });
      if (existingAfterRace) {
        return {
          ...existingAfterRace,
          isNew: false,
          mealToken: existingAfterRace,
        };
      }
    }
    throw error;
  }
}
