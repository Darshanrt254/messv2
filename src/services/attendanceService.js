import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import {
  getNow,
  getBusinessDate,
  parseBusinessDate,
  getISTComponents,
  isWeekday,
  isSaturday,
  isSunday,
  parseDateRange,
  getBusinessDatesList,
} from "../utils/businessTime.js";
import { getPollForCustomer } from "./pollService.js";
import { getCustomerServiceStatus } from "./customerEligibilityService.js";

/**
 * Retrieves today's complete meal and attendance state for the authenticated customer.
 */
export async function getCustomerTodayMealState(userId, date = getNow()) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  const businessDate = getBusinessDate(date);
  const ist = getISTComponents(date);

  // Check customer service & payment suspension status
  const eligibility = await getCustomerServiceStatus(profile.id, date);
  const isSuspended = eligibility.isServiceSuspended;
  const isPaymentBlocked = eligibility.isPaymentSuspended;

  // Fetch today's attendance records for customer
  const attendances = await prisma.attendance.findMany({
    where: {
      customerId: profile.id,
      date: businessDate,
    },
    include: {
      mealToken: true,
    },
  });

  const lunchRecord = attendances.find((a) => a.mealType === "LUNCH");
  const dinnerRecord = attendances.find((a) => a.mealType === "DINNER");

  const formatTokenInfo = (record) => {
    if (!record || !record.mealToken) return null;
    return {
      tokenId: record.mealToken.id,
      token: record.mealToken.token,
      generatedAt: record.mealToken.createdAt,
    };
  };

  // Fetch poll state for customer
  const pollState = await getPollForCustomer(profile.id, date);

  const lunchStatus = isSuspended
    ? (lunchRecord ? lunchRecord.status : "ABSENT")
    : (lunchRecord ? lunchRecord.status : "UNMARKED");
  const dinnerStatus = isSuspended
    ? (dinnerRecord ? dinnerRecord.status : "ABSENT")
    : (dinnerRecord ? dinnerRecord.status : "UNMARKED");

  return {
    businessDate: ist.dateString,
    dayOfWeek: ist.dayName,
    serviceStatus: eligibility.serviceStatus,
    isServiceSuspended: isSuspended,
    isPaymentSuspended: isPaymentBlocked,
    remainingTiffins: profile.remainingTiffins,
    lunch: {
      serviceAvailable: !isSuspended,
      status: lunchStatus,
      location: isSuspended ? null : (lunchRecord ? lunchRecord.location : null),
      locked: isSuspended || isPaymentBlocked || !!(lunchRecord && lunchRecord.status !== "UNMARKED"),
      mealToken: formatTokenInfo(lunchRecord),
    },
    dinner: {
      serviceAvailable: !isSunday(date) && !isSuspended,
      status: dinnerStatus,
      location: isSuspended ? null : (dinnerRecord ? dinnerRecord.location : null),
      locked: isSuspended || isPaymentBlocked || !!(dinnerRecord && dinnerRecord.status !== "UNMARKED"),
      mealToken: formatTokenInfo(dinnerRecord),
    },
    poll: pollState,
  };
}

/**
 * Marks customer daily attendance (PRESENT or ABSENT).
 * Enforces customer immutability (cannot change once marked).
 */
export async function markCustomerAttendance(userId, { mealType, status }, date = getNow()) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  if (!mealType || !["LUNCH", "DINNER"].includes(mealType)) {
    throw ApiError.badRequest("Meal type must be 'LUNCH' or 'DINNER'.");
  }

  if (!status || !["PRESENT", "ABSENT"].includes(status)) {
    throw ApiError.badRequest("Status must be either 'PRESENT' or 'ABSENT'.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  // Suspension & payment eligibility checks
  const eligibility = await getCustomerServiceStatus(profile.id, date);
  if (eligibility.isServiceSuspended) {
    throw ApiError.badRequest("Attendance cannot be marked: Service is suspended for this date.");
  }
  if (eligibility.isPaymentSuspended) {
    throw ApiError.conflict("Attendance cannot be marked: Customer account is payment-suspended due to zero tiffin balance.");
  }

  const businessDate = getBusinessDate(date);

  // Sunday Dinner Rule
  if (mealType === "DINNER" && isSunday(date)) {
    throw ApiError.badRequest("Dinner service is not available on Sunday.");
  }

  // Determine appropriate location based on meal type and day
  let resolvedLocation = null;

  if (mealType === "DINNER") {
    // Dinner has no poll; PRESENT is always RESTAURANT, ABSENT is null
    resolvedLocation = status === "PRESENT" ? "RESTAURANT" : null;
  } else if (mealType === "LUNCH") {
    if (status === "ABSENT") {
      resolvedLocation = null;
    } else {
      // status === "PRESENT"
      if (isSaturday(date) || isSunday(date)) {
        // Weekend lunch has no poll; PRESENT is RESTAURANT
        resolvedLocation = "RESTAURANT";
      } else {
        // Weekday lunch: location remains null until customer votes in poll,
        // unless customer already voted in today's poll prior to this call
        const poll = await prisma.poll.findUnique({
          where: {
            date_mealType: {
              date: businessDate,
              mealType: "LUNCH",
            },
          },
        });

        if (poll) {
          const existingVote = await prisma.pollVote.findUnique({
            where: {
              pollId_customerId: {
                pollId: poll.id,
                customerId: profile.id,
              },
            },
          });
          resolvedLocation = existingVote ? existingVote.option : null;
        } else {
          resolvedLocation = null;
        }
      }
    }
  }

  // Check for existing attendance record
  const existingAttendance = await prisma.attendance.findUnique({
    where: {
      customerId_date_mealType: {
        customerId: profile.id,
        date: businessDate,
        mealType,
      },
    },
  });

  // Immutability enforcement for customers
  if (existingAttendance && existingAttendance.status !== "UNMARKED") {
    if (existingAttendance.status !== status) {
      throw ApiError.conflict(
        `Attendance for ${mealType} is already confirmed as ${existingAttendance.status} and cannot be changed.`
      );
    }
    // Repeated request with same status: idempotent return
    return existingAttendance;
  }

  const now = date instanceof Date ? date : new Date(date);

  let attendance;
  if (existingAttendance) {
    attendance = await prisma.attendance.update({
      where: { id: existingAttendance.id },
      data: {
        status,
        location: resolvedLocation,
        source: "CUSTOMER",
        markedAt: now,
      },
    });
  } else {
    attendance = await prisma.attendance.create({
      data: {
        customerId: profile.id,
        date: businessDate,
        mealType,
        status,
        location: resolvedLocation,
        source: "CUSTOMER",
        markedAt: now,
      },
    });
  }

  return attendance;
}

/**
 * Lists attendance records for the OWNER operational view with optional filters.
 */
export async function listAttendanceForOwner({ date, customerId, mealType, status } = {}) {
  const where = {};

  if (date) {
    where.date = parseBusinessDate(date);
  } else {
    where.date = getBusinessDate();
  }

  if (customerId && typeof customerId === "string" && customerId.trim()) {
    where.customerId = customerId.trim();
  }

  if (mealType && ["LUNCH", "DINNER"].includes(mealType)) {
    where.mealType = mealType;
  }

  if (status && ["UNMARKED", "PRESENT", "ABSENT"].includes(status)) {
    where.status = status;
  }

  const records = await prisma.attendance.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      mealToken: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          remainingTiffins: true,
          serviceStatus: true,
          user: {
            select: {
              id: true,
              loginIdentifier: true,
            },
          },
        },
      },
    },
  });

  return records;
}

/**
 * Allows OWNER to manually update an attendance record with domain validation and audit logging.
 */
export async function updateAttendanceByOwner(attendanceId, { status, location }, actorId) {
  if (!attendanceId || typeof attendanceId !== "string") {
    throw ApiError.badRequest("Invalid attendance ID.");
  }

  const existing = await prisma.attendance.findUnique({
    where: { id: attendanceId },
    include: { mealToken: true },
  });

  if (!existing) {
    throw ApiError.notFound(`Attendance record with ID '${attendanceId}' not found.`);
  }

  // If attendance already has a MealToken, reject edits that alter status or location
  if (existing.mealToken) {
    if (
      (status !== undefined && status !== existing.status) ||
      (location !== undefined && location !== existing.location)
    ) {
      throw ApiError.conflict(
        `Cannot modify attendance: A meal token (${existing.mealToken.token}) has already been generated for this attendance record.`
      );
    }
  }

  const newStatus = status !== undefined ? status : existing.status;
  const newLocation = location !== undefined ? location : existing.location;

  // Validate status
  if (!["UNMARKED", "PRESENT", "ABSENT"].includes(newStatus)) {
    throw ApiError.badRequest("Invalid attendance status.");
  }

  // Validate location combinations
  if (existing.mealType === "DINNER") {
    if (newLocation === "COLLEGE") {
      throw ApiError.badRequest("College location is not permitted for dinner.");
    }
    if (newStatus === "PRESENT" && newLocation !== "RESTAURANT") {
      throw ApiError.badRequest("Dinner attendance marked PRESENT must have location RESTAURANT.");
    }
    if (newStatus === "ABSENT" && newLocation !== null) {
      throw ApiError.badRequest("Dinner attendance marked ABSENT must have null location.");
    }
  } else if (existing.mealType === "LUNCH") {
    if (newStatus === "ABSENT" && newLocation !== null) {
      throw ApiError.badRequest("Lunch attendance marked ABSENT must have null location.");
    }
    if (newLocation !== null && !["COLLEGE", "RESTAURANT"].includes(newLocation)) {
      throw ApiError.badRequest("Invalid lunch location.");
    }
  }

  // Transactionally update record and write AuditLog
  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.update({
      where: { id: attendanceId },
      data: {
        status: newStatus,
        location: newLocation,
        source: "OWNER",
        markedAt: getNow(),
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_UPDATED_ATTENDANCE",
        entityType: "Attendance",
        entityId: attendanceId,
        metadata: {
          customerId: existing.customerId,
          date: existing.date,
          mealType: existing.mealType,
          previousStatus: existing.status,
          newStatus,
          previousLocation: existing.location,
          newLocation,
        },
      },
    });

    return record;
  });

  return updated;
}

/**
 * Retrieves historical attendance records for the authenticated customer
 * across an inclusive business-date range [from, to].
 *
 * @param {string} userId - Authenticated customer's User ID
 * @param {object} params
 * @param {string} [params.from] - YYYY-MM-DD
 * @param {string} [params.to] - YYYY-MM-DD
 */
export async function getCustomerAttendanceHistory(userId, { from: fromStr, to: toStr } = {}) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  const range = parseDateRange(fromStr, toStr);

  const attendances = await prisma.attendance.findMany({
    where: {
      customerId: profile.id,
      date: {
        gte: range.fromDate,
        lte: range.toDate,
      },
    },
    include: {
      mealToken: {
        select: {
          id: true,
          token: true,
          createdAt: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  const datesList = getBusinessDatesList(range.from, range.to);

  const days = datesList.map((dateStr) => {
    const bDate = parseBusinessDate(dateStr);
    const ist = getISTComponents(bDate);
    const isSun = isSunday(bDate);

    const dayAtts = attendances.filter(
      (a) => new Date(a.date).toISOString().slice(0, 10) === new Date(bDate).toISOString().slice(0, 10)
    );

    const lunchRecord = dayAtts.find((a) => a.mealType === "LUNCH");
    const dinnerRecord = dayAtts.find((a) => a.mealType === "DINNER");

    return {
      date: dateStr,
      dayOfWeek: ist.dayName,
      lunch: {
        status: lunchRecord ? lunchRecord.status : "UNMARKED",
        location: lunchRecord && lunchRecord.status === "PRESENT" ? lunchRecord.location : null,
        mealToken: lunchRecord?.mealToken
          ? {
              tokenId: lunchRecord.mealToken.id,
              token: lunchRecord.mealToken.token,
            }
          : null,
      },
      dinner: {
        serviceAvailable: !isSun,
        status: isSun ? null : (dinnerRecord ? dinnerRecord.status : "UNMARKED"),
        location: !isSun && dinnerRecord && dinnerRecord.status === "PRESENT" ? dinnerRecord.location : null,
        mealToken: !isSun && dinnerRecord?.mealToken
          ? {
              tokenId: dinnerRecord.mealToken.id,
              token: dinnerRecord.mealToken.token,
            }
          : null,
      },
    };
  });

  return {
    dateRange: {
      from: range.from,
      to: range.to,
    },
    days,
  };
}

