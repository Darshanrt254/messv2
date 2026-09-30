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
} from "../utils/businessTime.js";
import { getPollForCustomer } from "./pollService.js";

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

  return {
    businessDate: ist.dateString,
    dayOfWeek: ist.dayName,
    lunch: {
      serviceAvailable: true,
      status: lunchRecord ? lunchRecord.status : "UNMARKED",
      location: lunchRecord ? lunchRecord.location : null,
      locked: !!(lunchRecord && lunchRecord.status !== "UNMARKED"),
      mealToken: formatTokenInfo(lunchRecord),
    },
    dinner: {
      serviceAvailable: !isSunday(date),
      status: dinnerRecord ? dinnerRecord.status : "UNMARKED",
      location: dinnerRecord ? dinnerRecord.location : null,
      locked: !!(dinnerRecord && dinnerRecord.status !== "UNMARKED"),
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
