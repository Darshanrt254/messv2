import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import {
  getNow,
  getBusinessDate,
  parseBusinessDate,
  getISTComponents,
  isSunday,
} from "../utils/businessTime.js";
import { getCustomerServiceStatus } from "./customerEligibilityService.js";
import { generateMealToken } from "./mealTokenService.js";

/**
 * Checks whether Lunch finalization is due for the given time (at or after 16:00 IST).
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isLunchFinalizationDue(date = getNow()) {
  const ist = getISTComponents(date);
  return ist.hours >= 16;
}

/**
 * Checks whether Dinner finalization is due for the given time (at or after 23:00 IST).
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isDinnerFinalizationDue(date = getNow()) {
  const ist = getISTComponents(date);
  return ist.hours >= 23;
}

/**
 * Processes automated finalization for a single customer and meal.
 *
 * Rules:
 * 1. Service Suspended -> attendance ABSENT (source: SUSPENSION), no token, no deduction.
 * 2. Already ABSENT -> untouched (no token, no deduction).
 * 3. Already PRESENT + COLLEGE -> untouched (no token generated, no location change).
 * 4. Already PRESENT + RESTAURANT:
 *    - with token: untouched (alreadyFinalized).
 *    - without token: calls generateMealToken to issue missing token.
 * 5. Already PRESENT with location null:
 *    - update location to RESTAURANT, call generateMealToken.
 * 6. UNMARKED:
 *    - Payment Suspended (remainingTiffins <= 0) -> skipped (no meal, no deduction).
 *    - Active -> mark PRESENT + RESTAURANT + AUTO, call generateMealToken.
 *    - If token generation fails -> safely revert attendance.
 */
async function processCustomerMealFinalization({ customer, businessDate, mealType }) {
  // 1. Check customer eligibility
  const eligibility = await getCustomerServiceStatus(customer.id, businessDate);

  // 2. Fetch existing attendance for this date & meal
  const attendance = await prisma.attendance.findUnique({
    where: {
      customerId_date_mealType: {
        customerId: customer.id,
        date: businessDate,
        mealType,
      },
    },
    include: {
      mealToken: true,
    },
  });

  // 3. Service Suspension Check
  if (eligibility.isServiceSuspended) {
    if (!attendance || attendance.status === "UNMARKED") {
      await prisma.attendance.upsert({
        where: {
          customerId_date_mealType: {
            customerId: customer.id,
            date: businessDate,
            mealType,
          },
        },
        update: {
          status: "ABSENT",
          source: "SUSPENSION",
          location: null,
        },
        create: {
          customerId: customer.id,
          date: businessDate,
          mealType,
          status: "ABSENT",
          source: "SUSPENSION",
          location: null,
        },
      });
    }
    return { status: "SKIPPED_SUSPENDED" };
  }

  // 4. Existing ABSENT attendance -> do nothing
  if (attendance && attendance.status === "ABSENT") {
    return { status: "SKIPPED_ABSENT" };
  }

  // 5. Existing PRESENT attendance
  if (attendance && attendance.status === "PRESENT") {
    // If token is already issued, do nothing
    if (attendance.mealToken) {
      return { status: "ALREADY_FINALIZED", tokenId: attendance.mealToken.id };
    }

    // If location is COLLEGE (e.g. voted in lunch poll) -> preserve COLLEGE
    if (attendance.location === "COLLEGE") {
      return { status: "ALREADY_FINALIZED" };
    }

    // If location is null, set to RESTAURANT
    let targetLocation = attendance.location;
    if (!targetLocation) {
      targetLocation = "RESTAURANT";
      await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          location: "RESTAURANT",
          source: attendance.source === "CUSTOMER" ? "CUSTOMER" : "AUTO",
        },
      });
    }

    // Call authoritative Phase 5 token generation service to generate missing token
    const tokenResult = await generateMealToken({
      attendanceId: attendance.id,
      actorId: null,
    });

    if (tokenResult.isNew === false) {
      return { status: "ALREADY_FINALIZED", tokenId: tokenResult.id };
    }
    return { status: "FINALIZED", tokenId: tokenResult.id };
  }

  // 6. UNMARKED Attendance (or record does not exist yet)
  // Check Payment Suspension
  if (eligibility.isPaymentSuspended || customer.remainingTiffins <= 0) {
    return { status: "SKIPPED_PAYMENT_SUSPENDED" };
  }

  // Eligible customer -> upsert attendance as PRESENT + RESTAURANT + AUTO
  const targetAttendance = await prisma.attendance.upsert({
    where: {
      customerId_date_mealType: {
        customerId: customer.id,
        date: businessDate,
        mealType,
      },
    },
    update: {
      status: "PRESENT",
      location: "RESTAURANT",
      source: "AUTO",
      markedAt: getNow(),
    },
    create: {
      customerId: customer.id,
      date: businessDate,
      mealType,
      status: "PRESENT",
      location: "RESTAURANT",
      source: "AUTO",
      markedAt: getNow(),
    },
  });

  // Call authoritative Phase 5 token generation service
  try {
    const tokenResult = await generateMealToken({
      attendanceId: targetAttendance.id,
      actorId: null,
    });

    if (tokenResult.isNew === false) {
      return { status: "ALREADY_FINALIZED", tokenId: tokenResult.id };
    }
    return { status: "FINALIZED", tokenId: tokenResult.id };
  } catch (err) {
    // If token generation failed, revert attendance to avoid leaving an unpaid PRESENT meal
    try {
      await prisma.attendance.update({
        where: { id: targetAttendance.id },
        data: {
          status: "UNMARKED",
          location: null,
          source: "CUSTOMER",
        },
      });
    } catch {
      // Ignore cleanup error if record was already modified concurrently
    }

    if (
      err.message?.includes("tiffin balance") ||
      err.message?.includes("zero remaining") ||
      err.message?.includes("payment-suspended")
    ) {
      return { status: "SKIPPED_PAYMENT_SUSPENDED" };
    }
    return { status: "FAILED", error: err.message };
  }
}

/**
 * Authoritative meal finalization engine for a specific business date and meal.
 *
 * @param {object} params
 * @param {Date|string} [params.date=getNow()] - Business date to finalize
 * @param {"LUNCH"|"DINNER"} params.mealType - Meal type to finalize
 * @param {object} [params.options={}]
 * @param {boolean} [params.options.enforceTimeWindow=false] - If true, enforces 16:00 IST for lunch and 23:00 IST for dinner
 * @returns {Promise<{
 *   date: string,
 *   mealType: string,
 *   processed: number,
 *   finalized: number,
 *   alreadyFinalized: number,
 *   skippedSuspended: number,
 *   skippedPaymentSuspended: number,
 *   skippedAbsent: number,
 *   failed: number,
 *   errors: Array<{ customerId: string, error: string }>
 * }>}
 */
export async function finalizeMealForDate({ date = getNow(), mealType, options = {} }) {
  if (!mealType || !["LUNCH", "DINNER"].includes(mealType)) {
    throw ApiError.badRequest("Meal type must be either 'LUNCH' or 'DINNER'.");
  }

  const effectiveDate =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? parseBusinessDate(date)
      : date instanceof Date
      ? date
      : new Date(date);

  const businessDate = getBusinessDate(effectiveDate);
  const ist = getISTComponents(effectiveDate);

  // Time window enforcement if requested
  if (options.enforceTimeWindow) {
    if (mealType === "LUNCH" && !isLunchFinalizationDue(effectiveDate)) {
      throw ApiError.badRequest(
        "Lunch finalization is not due yet. Scheduled execution is allowed at or after 16:00 IST."
      );
    }
    if (mealType === "DINNER" && !isDinnerFinalizationDue(effectiveDate)) {
      throw ApiError.badRequest(
        "Dinner finalization is not due yet. Scheduled execution is allowed at or after 23:00 IST."
      );
    }
  }

  // Sunday Dinner Rule: Sunday has no dinner service
  if (mealType === "DINNER" && isSunday(effectiveDate)) {
    return {
      date: ist.dateString,
      mealType: "DINNER",
      processed: 0,
      finalized: 0,
      alreadyFinalized: 0,
      skippedSuspended: 0,
      skippedPaymentSuspended: 0,
      skippedAbsent: 0,
      failed: 0,
      errors: [],
      message: "Dinner service is not available on Sunday.",
    };
  }

  // Fetch all customer profiles
  const customers = await prisma.customerProfile.findMany({
    orderBy: { createdAt: "asc" },
  });

  let processed = 0;
  let finalized = 0;
  let alreadyFinalized = 0;
  let skippedSuspended = 0;
  let skippedPaymentSuspended = 0;
  let skippedAbsent = 0;
  let failed = 0;
  const errors = [];

  for (const customer of customers) {
    processed++;
    try {
      const res = await processCustomerMealFinalization({
        customer,
        businessDate,
        mealType,
        date: effectiveDate,
      });

      switch (res.status) {
        case "FINALIZED":
          finalized++;
          break;
        case "ALREADY_FINALIZED":
          alreadyFinalized++;
          break;
        case "SKIPPED_SUSPENDED":
          skippedSuspended++;
          break;
        case "SKIPPED_PAYMENT_SUSPENDED":
          skippedPaymentSuspended++;
          break;
        case "SKIPPED_ABSENT":
          skippedAbsent++;
          break;
        case "FAILED":
          failed++;
          errors.push({ customerId: customer.id, error: res.error });
          break;
      }
    } catch (err) {
      failed++;
      errors.push({ customerId: customer.id, error: err.message });
    }
  }

  // Batch AuditLog for the automated finalization run
  try {
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: "AUTO_MEAL_FINALIZED",
        entityType: "DailyFinalization",
        metadata: {
          businessDate: ist.dateString,
          mealType,
          processed,
          finalized,
          alreadyFinalized,
          skippedSuspended,
          skippedPaymentSuspended,
          skippedAbsent,
          failed,
        },
      },
    });
  } catch {
    // Non-blocking in case of testing mocks
  }

  return {
    date: ist.dateString,
    mealType,
    processed,
    finalized,
    alreadyFinalized,
    skippedSuspended,
    skippedPaymentSuspended,
    skippedAbsent,
    failed,
    errors,
  };
}

/**
 * Finalizes lunch attendance and tokens for the given date.
 */
export async function finalizeLunchForDate(date = getNow(), options = {}) {
  return finalizeMealForDate({ date, mealType: "LUNCH", options });
}

/**
 * Finalizes dinner attendance and tokens for the given date.
 */
export async function finalizeDinnerForDate(date = getNow(), options = {}) {
  return finalizeMealForDate({ date, mealType: "DINNER", options });
}
