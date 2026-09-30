import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import {
  getNow,
  getBusinessDate,
  getLunchPollWindow,
  isWeekday,
  isSaturday,
  isSunday,
} from "../utils/businessTime.js";

/**
 * Deterministically retrieves or creates today's Lunch Poll for Monday-Friday.
 * Returns null on Saturday and Sunday.
 * Concurrency-safe via unique constraint on (date, mealType).
 */
export async function getOrCreateTodayLunchPoll(date = getNow()) {
  if (!isWeekday(date)) {
    return null;
  }

  const businessDate = getBusinessDate(date);
  const pollWindow = getLunchPollWindow(date);
  const calculatedStatus = pollWindow.isOpen ? "OPEN" : "CLOSED";

  const poll = await prisma.poll.upsert({
    where: {
      date_mealType: {
        date: businessDate,
        mealType: "LUNCH",
      },
    },
    update: {
      status: calculatedStatus,
    },
    create: {
      date: businessDate,
      mealType: "LUNCH",
      opensAt: pollWindow.opensAt,
      closesAt: pollWindow.closesAt,
      status: calculatedStatus,
    },
  });

  return poll;
}

/**
 * Retrieves the today's lunch poll state and voter eligibility for a specific customer.
 */
export async function getPollForCustomer(customerId, date = getNow()) {
  if (!customerId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  if (isSaturday(date) || isSunday(date)) {
    return {
      pollExists: false,
      eligible: false,
      status: null,
      opensAt: null,
      closesAt: null,
      options: [],
      existingVote: null,
      locked: true,
      reason: "WEEKEND",
    };
  }

  const businessDate = getBusinessDate(date);
  const poll = await getOrCreateTodayLunchPoll(date);
  const pollWindow = getLunchPollWindow(date);

  // Check customer's current lunch attendance
  const lunchAttendance = await prisma.attendance.findUnique({
    where: {
      customerId_date_mealType: {
        customerId,
        date: businessDate,
        mealType: "LUNCH",
      },
    },
  });

  // Check customer's existing vote
  const existingVote = await prisma.pollVote.findUnique({
    where: {
      pollId_customerId: {
        pollId: poll.id,
        customerId,
      },
    },
  });

  let eligible = false;
  let locked = true;
  let reason = null;

  if (existingVote) {
    eligible = false;
    locked = true;
    reason = "ALREADY_VOTED";
  } else if (lunchAttendance && lunchAttendance.status === "ABSENT") {
    eligible = false;
    locked = true;
    reason = "LUNCH_ABSENT";
  } else if (pollWindow.isBeforeOpen) {
    eligible = false;
    locked = true;
    reason = "NOT_OPEN_YET";
  } else if (pollWindow.isAfterClose) {
    eligible = false;
    locked = true;
    reason = "CLOSED";
  } else {
    eligible = true;
    locked = false;
    reason = null;
  }

  return {
    pollExists: true,
    eligible,
    status: pollWindow.isOpen ? "OPEN" : "CLOSED",
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    options: ["COLLEGE", "RESTAURANT"],
    existingVote: existingVote ? existingVote.option : null,
    locked,
    reason,
  };
}

/**
 * Casts a vote in today's lunch location poll.
 * Transactionally updates customer's lunch attendance to PRESENT with selected location.
 */
export async function voteInPoll({ customerId, location, date = getNow() }) {
  if (!customerId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  if (!location || !["COLLEGE", "RESTAURANT"].includes(location)) {
    throw ApiError.badRequest("Location must be either 'COLLEGE' or 'RESTAURANT'.");
  }

  if (!isWeekday(date)) {
    throw ApiError.badRequest("Lunch poll is available only Monday through Friday.");
  }

  const pollWindow = getLunchPollWindow(date);
  if (pollWindow.isBeforeOpen) {
    throw ApiError.badRequest("Lunch poll has not opened yet. Voting is available between 06:00 and 11:30 IST.");
  }
  if (pollWindow.isAfterClose) {
    throw ApiError.badRequest("Lunch poll has closed. Voting is only available between 06:00 and 11:30 IST.");
  }

  const businessDate = getBusinessDate(date);
  const poll = await getOrCreateTodayLunchPoll(date);

  // Check if lunch attendance is already marked ABSENT
  const currentAttendance = await prisma.attendance.findUnique({
    where: {
      customerId_date_mealType: {
        customerId,
        date: businessDate,
        mealType: "LUNCH",
      },
    },
  });

  if (currentAttendance && currentAttendance.status === "ABSENT") {
    throw ApiError.badRequest("Cannot vote in lunch poll because lunch attendance is marked ABSENT.");
  }

  // Check if customer already voted
  const existingVote = await prisma.pollVote.findUnique({
    where: {
      pollId_customerId: {
        pollId: poll.id,
        customerId,
      },
    },
  });

  if (existingVote) {
    throw ApiError.conflict("You have already voted in today's lunch poll. Vote cannot be changed.");
  }

  const now = date instanceof Date ? date : new Date(date);

  // Transactionally record vote and update/create Lunch Attendance
  const result = await prisma.$transaction(async (tx) => {
    // 1. Record Vote
    const pollVote = await tx.pollVote.create({
      data: {
        pollId: poll.id,
        customerId,
        option: location,
        votedAt: now,
      },
    });

    // 2. Update or Create Lunch Attendance
    let attendance;
    if (currentAttendance) {
      attendance = await tx.attendance.update({
        where: { id: currentAttendance.id },
        data: {
          status: "PRESENT",
          location: location,
          markedAt: now,
        },
      });
    } else {
      attendance = await tx.attendance.create({
        data: {
          customerId,
          date: businessDate,
          mealType: "LUNCH",
          status: "PRESENT",
          location: location,
          source: "CUSTOMER",
          markedAt: now,
        },
      });
    }

    return {
      vote: pollVote.option,
      attendance: {
        id: attendance.id,
        status: attendance.status,
        location: attendance.location,
        mealType: attendance.mealType,
        date: attendance.date,
      },
    };
  });

  return result;
}
