import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import {
  getNow,
  getBusinessDate,
  parseBusinessDate,
  getISTComponents,
  isSunday,
  isSaturday,
  isWeekday,
  isValidDateString,
  parseDateRange,
} from "../utils/businessTime.js";

/**
 * 1. Overview Analytics
 * High-level operational summary for a specified date range.
 *
 * @param {object} params
 * @param {string} [params.from] - Start date (YYYY-MM-DD)
 * @param {string} [params.to] - End date (YYYY-MM-DD)
 */
export async function getOverviewAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  // 1. Customers
  const totalCustomers = await prisma.customerProfile.count();
  const paymentSuspendedCustomers = await prisma.customerProfile.count({
    where: { remainingTiffins: { lte: 0 } },
  });

  // Distinct service suspended customers on 'to' date
  let activeSuspensionsCount = 0;
  try {
    const suspensions = await prisma.serviceSuspension.findMany({
      where: {
        startDate: { lte: range.toDate },
        endDate: { gte: range.toDate },
      },
      select: { customerId: true },
    });
    const uniqueSuspended = new Set(suspensions.map((s) => s.customerId));
    activeSuspensionsCount = uniqueSuspended.size;
  } catch {
    activeSuspensionsCount = 0;
  }

  const activeCustomers = Math.max(0, totalCustomers - activeSuspensionsCount - paymentSuspendedCustomers);

  // 2. Attendance
  const attendanceGroups = await prisma.attendance.groupBy({
    by: ["mealType", "status"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
    _count: true,
  });

  const attendance = {
    lunch: { present: 0, absent: 0, unmarked: 0 },
    dinner: { present: 0, absent: 0, unmarked: 0 },
  };

  for (const g of attendanceGroups) {
    const meal = g.mealType === "LUNCH" ? "lunch" : "dinner";
    const status = g.status.toLowerCase();
    if (attendance[meal] && attendance[meal][status] !== undefined) {
      attendance[meal][status] = g._count;
    }
  }

  // 3. Meals (authoritative: MealToken table)
  const mealTokenGroups = await prisma.mealToken.groupBy({
    by: ["mealType"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
    _count: true,
  });

  let lunchMeals = 0;
  let dinnerMeals = 0;
  for (const g of mealTokenGroups) {
    if (g.mealType === "LUNCH") lunchMeals = g._count;
    if (g.mealType === "DINNER") dinnerMeals = g._count;
  }
  const totalMeals = lunchMeals + dinnerMeals;

  // 4. Locations (authoritative: Attendance with PRESENT and non-null location)
  const locationGroups = await prisma.attendance.groupBy({
    by: ["mealType", "location"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
      status: "PRESENT",
      location: { not: null },
    },
    _count: true,
  });

  const locations = {
    lunch: { restaurant: 0, college: 0 },
    dinner: { restaurant: 0, college: 0 },
  };

  for (const g of locationGroups) {
    const meal = g.mealType === "LUNCH" ? "lunch" : "dinner";
    const loc = g.location === "RESTAURANT" ? "restaurant" : "college";
    if (locations[meal] && locations[meal][loc] !== undefined) {
      locations[meal][loc] = g._count;
    }
  }

  // 5. Tiffins (authoritative: TiffinTransaction)
  const txGroups = await prisma.tiffinTransaction.groupBy({
    by: ["type"],
    where: {
      createdAt: { gte: range.fromTimestamp, lt: range.toTimestampExclusive },
    },
    _sum: { quantity: true },
  });

  let tiffinsConsumed = 0;
  let tiffinsRecharged = 0;
  for (const g of txGroups) {
    if (g.type === "MEAL_TOKEN") {
      tiffinsConsumed = Math.abs(g._sum?.quantity || 0);
    } else if (g.type === "CASH_RECHARGE") {
      tiffinsRecharged = g._sum?.quantity || 0;
    }
  }

  // 6. Polls
  let pollCollege = 0;
  let pollRestaurant = 0;
  try {
    const pollVoteGroups = await prisma.pollVote.groupBy({
      by: ["location"],
      where: {
        poll: {
          date: { gte: range.fromDate, lte: range.toDate },
        },
      },
      _count: true,
    });

    for (const g of pollVoteGroups) {
      if (g.location === "COLLEGE") pollCollege = g._count;
      if (g.location === "RESTAURANT") pollRestaurant = g._count;
    }
  } catch {
    pollCollege = 0;
    pollRestaurant = 0;
  }

  // 7. Messages
  const messageGroups = await prisma.message.groupBy({
    by: ["status"],
    where: {
      createdAt: { gte: range.fromTimestamp, lt: range.toTimestampExclusive },
    },
    _count: true,
  });

  const messages = { unread: 0, read: 0, resolved: 0 };
  for (const g of messageGroups) {
    const st = g.status.toLowerCase();
    if (messages[st] !== undefined) {
      messages[st] = g._count;
    }
  }

  return {
    dateRange: { from: range.from, to: range.to },
    customers: {
      total: totalCustomers,
      active: activeCustomers,
      serviceSuspended: activeSuspensionsCount,
      paymentSuspended: paymentSuspendedCustomers,
    },
    attendance,
    meals: {
      lunch: lunchMeals,
      dinner: dinnerMeals,
      total: totalMeals,
    },
    locations,
    tiffins: {
      consumed: tiffinsConsumed,
      recharged: tiffinsRecharged,
    },
    polls: {
      votes: pollCollege + pollRestaurant,
      college: pollCollege,
      restaurant: pollRestaurant,
    },
    messages,
  };
}

/**
 * 2. Daily Attendance Analytics
 * Provides daily breakdown of attendance records by status and meal type.
 */
export async function getAttendanceAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const groups = await prisma.attendance.groupBy({
    by: ["date", "mealType", "status"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
    _count: true,
  });

  const daysMap = new Map();

  for (const g of groups) {
    const dStr = getISTComponents(g.date).dateString;
    if (!daysMap.has(dStr)) {
      daysMap.set(dStr, {
        date: dStr,
        lunch: { present: 0, absent: 0, unmarked: 0 },
        dinner: { present: 0, absent: 0, unmarked: 0 },
      });
    }
    const day = daysMap.get(dStr);
    const meal = g.mealType === "LUNCH" ? "lunch" : "dinner";
    const status = g.status.toLowerCase();
    if (day[meal] && day[meal][status] !== undefined) {
      day[meal][status] = g._count;
    }
  }

  const days = Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const totals = {
    lunch: { present: 0, absent: 0, unmarked: 0 },
    dinner: { present: 0, absent: 0, unmarked: 0 },
  };

  for (const d of days) {
    totals.lunch.present += d.lunch.present;
    totals.lunch.absent += d.lunch.absent;
    totals.lunch.unmarked += d.lunch.unmarked;
    totals.dinner.present += d.dinner.present;
    totals.dinner.absent += d.dinner.absent;
    totals.dinner.unmarked += d.dinner.unmarked;
  }

  return {
    dateRange: { from: range.from, to: range.to },
    days,
    totals,
  };
}

/**
 * 3. Location Analytics
 * Reports Restaurant vs College distribution for Lunch and Dinner.
 */
export async function getLocationAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const groups = await prisma.attendance.groupBy({
    by: ["mealType", "location"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
      status: "PRESENT",
      location: { not: null },
    },
    _count: true,
  });

  const res = {
    dateRange: { from: range.from, to: range.to },
    lunch: { restaurant: 0, college: 0, total: 0 },
    dinner: { restaurant: 0, college: 0, total: 0 },
    total: 0,
  };

  for (const g of groups) {
    const meal = g.mealType === "LUNCH" ? "lunch" : "dinner";
    const loc = g.location === "RESTAURANT" ? "restaurant" : "college";
    if (res[meal] && res[meal][loc] !== undefined) {
      res[meal][loc] = g._count;
    }
  }

  res.lunch.total = res.lunch.restaurant + res.lunch.college;
  res.dinner.total = res.dinner.restaurant + res.dinner.college;
  res.total = res.lunch.total + res.dinner.total;

  return res;
}

/**
 * 4. Meal Consumption Analytics
 * Authoritative count of consumed meals based on issued MealToken records.
 */
export async function getMealConsumptionAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const groups = await prisma.mealToken.groupBy({
    by: ["date", "mealType"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
    _count: true,
  });

  const daysMap = new Map();
  let lunchTotal = 0;
  let dinnerTotal = 0;

  for (const g of groups) {
    const dStr = getISTComponents(g.date).dateString;
    if (!daysMap.has(dStr)) {
      daysMap.set(dStr, {
        date: dStr,
        lunch: 0,
        dinner: 0,
        total: 0,
      });
    }
    const day = daysMap.get(dStr);
    if (g.mealType === "LUNCH") {
      day.lunch += g._count;
      lunchTotal += g._count;
    } else if (g.mealType === "DINNER") {
      day.dinner += g._count;
      dinnerTotal += g._count;
    }
    day.total = day.lunch + day.dinner;
  }

  const days = Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    dateRange: { from: range.from, to: range.to },
    lunch: lunchTotal,
    dinner: dinnerTotal,
    total: lunchTotal + dinnerTotal,
    days,
  };
}

/**
 * 5. Tiffin Ledger Analytics
 * Authoritative ledger summary based on TiffinTransaction quantities.
 */
export async function getTiffinLedgerAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const groups = await prisma.tiffinTransaction.groupBy({
    by: ["type"],
    where: {
      createdAt: { gte: range.fromTimestamp, lt: range.toTimestampExclusive },
    },
    _sum: { quantity: true },
    _count: true,
  });

  let initialBalance = 0;
  let cashRecharge = 0;
  let mealConsumption = 0;
  let adjustments = 0;

  const counts = {
    initialBalance: 0,
    cashRecharge: 0,
    mealToken: 0,
    adjustment: 0,
    total: 0,
  };

  for (const g of groups) {
    const qty = g._sum?.quantity || 0;
    const cnt = g._count || 0;
    counts.total += cnt;

    switch (g.type) {
      case "INITIAL_BALANCE":
        initialBalance += qty;
        counts.initialBalance = cnt;
        break;
      case "CASH_RECHARGE":
        cashRecharge += qty;
        counts.cashRecharge = cnt;
        break;
      case "MEAL_TOKEN":
        mealConsumption += Math.abs(qty);
        counts.mealToken = cnt;
        break;
      case "ADJUSTMENT":
        adjustments += qty;
        counts.adjustment = cnt;
        break;
    }
  }

  const netChange = initialBalance + cashRecharge - mealConsumption + adjustments;

  return {
    dateRange: { from: range.from, to: range.to },
    initialBalance,
    cashRecharge,
    mealConsumption,
    adjustments,
    netChange,
    counts,
  };
}

/**
 * 6. Balance Analytics
 * Distribution of current customer tiffin balances.
 */
export async function getBalanceAnalytics() {
  const profiles = await prisma.customerProfile.findMany({
    select: { remainingTiffins: true },
  });

  const totalCustomers = profiles.length;
  let totalRemainingTiffins = 0;
  let lowBalanceCount = 0;
  let veryLowBalanceCount = 0;
  let paymentPendingCount = 0;

  for (const p of profiles) {
    totalRemainingTiffins += p.remainingTiffins;
    if (p.remainingTiffins === 0) {
      paymentPendingCount++;
    }
    if (p.remainingTiffins <= 10) {
      lowBalanceCount++;
    }
    if (p.remainingTiffins <= 5) {
      veryLowBalanceCount++;
    }
  }

  const averageRemainingTiffins =
    totalCustomers > 0 ? Math.round((totalRemainingTiffins / totalCustomers) * 10) / 10 : 0;

  return {
    totalCustomers,
    totalRemainingTiffins,
    averageRemainingTiffins,
    lowBalance: {
      count: lowBalanceCount,
      threshold: 10,
    },
    veryLowBalance: {
      count: veryLowBalanceCount,
      threshold: 5,
    },
    paymentPending: {
      count: paymentPendingCount,
      threshold: 0,
    },
  };
}

/**
 * 7. Customer Status Analytics
 * Status snapshot for a specific evaluation date.
 */
export async function getCustomerStatusAnalytics({ date: dateStr } = {}) {
  const todayStr = getISTComponents(getNow()).dateString;
  const targetStr = dateStr || todayStr;

  if (!isValidDateString(targetStr)) {
    throw ApiError.badRequest(`Invalid date format: '${dateStr}'. Expected YYYY-MM-DD.`);
  }

  const businessDate = parseBusinessDate(targetStr);
  const profiles = await prisma.customerProfile.findMany({
    select: { id: true, remainingTiffins: true },
  });

  const totalCustomers = profiles.length;
  const paymentSuspendedSet = new Set();

  for (const p of profiles) {
    if (p.remainingTiffins <= 0) {
      paymentSuspendedSet.add(p.id);
    }
  }

  let serviceSuspendedSet = new Set();
  try {
    const suspensions = await prisma.serviceSuspension.findMany({
      where: {
        startDate: { lte: businessDate },
        endDate: { gte: businessDate },
      },
      select: { customerId: true },
    });
    serviceSuspendedSet = new Set(suspensions.map((s) => s.customerId));
  } catch {
    serviceSuspendedSet = new Set();
  }

  let dualSuspendedCount = 0;
  for (const id of paymentSuspendedSet) {
    if (serviceSuspendedSet.has(id)) {
      dualSuspendedCount++;
    }
  }

  const activeCount = profiles.filter(
    (p) => !paymentSuspendedSet.has(p.id) && !serviceSuspendedSet.has(p.id)
  ).length;

  return {
    evaluationDate: targetStr,
    totalCustomers,
    active: activeCount,
    serviceSuspended: serviceSuspendedSet.size,
    paymentSuspended: paymentSuspendedSet.size,
    dualSuspended: dualSuspendedCount,
  };
}

/**
 * 8. Suspension Analytics
 * Historical and active service suspension activity.
 */
export async function getSuspensionAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const suspensions = await prisma.serviceSuspension.findMany({
    where: {
      OR: [
        { startDate: { gte: range.fromDate, lte: range.toDate } },
        { endDate: { gte: range.fromDate, lte: range.toDate } },
        { startDate: { lte: range.fromDate }, endDate: { gte: range.toDate } },
      ],
    },
  });

  const distinctCustomers = new Set(suspensions.map((s) => s.customerId));
  const today = getBusinessDate(getNow());

  let activeSuspensions = 0;
  let completedSuspensions = 0;

  for (const s of suspensions) {
    if (new Date(s.endDate) >= today) {
      activeSuspensions++;
    } else {
      completedSuspensions++;
    }
  }

  return {
    dateRange: { from: range.from, to: range.to },
    totalSuspensionRecords: suspensions.length,
    distinctCustomersAffected: distinctCustomers.size,
    activeSuspensions,
    completedSuspensions,
  };
}

/**
 * 9. Poll Analytics
 * Participation and vote distribution for weekday lunch polls.
 */
export async function getPollAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const pollsCount = await prisma.poll.count({
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
  });

  let collegeVotes = 0;
  let restaurantVotes = 0;

  try {
    const voteGroups = await prisma.pollVote.groupBy({
      by: ["location"],
      where: {
        poll: {
          date: { gte: range.fromDate, lte: range.toDate },
        },
      },
      _count: true,
    });

    for (const g of voteGroups) {
      if (g.location === "COLLEGE") collegeVotes = g._count;
      if (g.location === "RESTAURANT") restaurantVotes = g._count;
    }
  } catch {
    collegeVotes = 0;
    restaurantVotes = 0;
  }

  return {
    dateRange: { from: range.from, to: range.to },
    totalPolls: pollsCount,
    totalVotes: collegeVotes + restaurantVotes,
    college: collegeVotes,
    restaurant: restaurantVotes,
  };
}

/**
 * 10. Message Analytics
 * Customer message status breakdown.
 */
export async function getMessageAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const groups = await prisma.message.groupBy({
    by: ["status"],
    where: {
      createdAt: { gte: range.fromTimestamp, lt: range.toTimestampExclusive },
    },
    _count: true,
  });

  const res = {
    dateRange: { from: range.from, to: range.to },
    totalMessages: 0,
    unread: 0,
    read: 0,
    resolved: 0,
  };

  for (const g of groups) {
    const st = g.status.toLowerCase();
    if (res[st] !== undefined) {
      res[st] = g._count;
      res.totalMessages += g._count;
    }
  }

  return res;
}

/**
 * 11. Token Analytics
 * Authoritative breakdown of MealToken records issued.
 */
export async function getTokenAnalytics({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);

  const tokens = await prisma.mealToken.groupBy({
    by: ["date", "mealType", "location"],
    where: {
      date: { gte: range.fromDate, lte: range.toDate },
    },
    _count: true,
  });

  let totalTokens = 0;
  let lunchTokens = 0;
  let dinnerTokens = 0;
  let restaurantTokens = 0;
  let collegeTokens = 0;

  const daysMap = new Map();

  for (const t of tokens) {
    const dStr = getISTComponents(t.date).dateString;
    if (!daysMap.has(dStr)) {
      daysMap.set(dStr, {
        date: dStr,
        total: 0,
        lunch: 0,
        dinner: 0,
        restaurant: 0,
        college: 0,
      });
    }
    const day = daysMap.get(dStr);
    const count = t._count;

    totalTokens += count;
    day.total += count;

    if (t.mealType === "LUNCH") {
      lunchTokens += count;
      day.lunch += count;
    } else if (t.mealType === "DINNER") {
      dinnerTokens += count;
      day.dinner += count;
    }

    if (t.location === "RESTAURANT") {
      restaurantTokens += count;
      day.restaurant += count;
    } else if (t.location === "COLLEGE") {
      collegeTokens += count;
      day.college += count;
    }
  }

  const days = Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return {
    dateRange: { from: range.from, to: range.to },
    totalTokens,
    lunchTokens,
    dinnerTokens,
    restaurantTokens,
    collegeTokens,
    days,
  };
}

/**
 * 12. Daily Operational Summary
 * Comprehensive daily snapshot of operations, attendance, tokens, and poll.
 */
export async function getDailyOperationalSummary(dateInput) {
  const dateStr = typeof dateInput === "object" && dateInput !== null ? dateInput.date : dateInput;
  const todayStr = getISTComponents(getNow()).dateString;
  const effectiveStr = dateStr || todayStr;

  if (!isValidDateString(effectiveStr)) {
    throw ApiError.badRequest(`Invalid date format: '${dateStr}'. Expected YYYY-MM-DD.`);
  }

  const businessDate = parseBusinessDate(effectiveStr);
  const ist = getISTComponents(businessDate);
  const isSun = isSunday(businessDate);
  const isWkday = isWeekday(businessDate);

  // 1. Attendance
  const attendances = await prisma.attendance.findMany({
    where: { date: businessDate },
  });

  const lunchAtt = { present: 0, absent: 0, unmarked: 0, restaurant: 0, college: 0 };
  const dinnerAtt = { present: 0, absent: 0, unmarked: 0, restaurant: 0, college: 0 };

  for (const a of attendances) {
    const target = a.mealType === "LUNCH" ? lunchAtt : dinnerAtt;
    if (a.status === "PRESENT") {
      target.present++;
      if (a.location === "RESTAURANT") target.restaurant++;
      else if (a.location === "COLLEGE") target.college++;
    } else if (a.status === "ABSENT") {
      target.absent++;
    } else {
      target.unmarked++;
    }
  }

  // 2. Meal tokens
  const tokens = await prisma.mealToken.findMany({
    where: { date: businessDate },
    select: { mealType: true },
  });

  const lunchTokenCount = tokens.filter((t) => t.mealType === "LUNCH").length;
  const dinnerTokenCount = tokens.filter((t) => t.mealType === "DINNER").length;

  // 3. Poll
  let pollInfo = { available: false, votes: 0, college: 0, restaurant: 0 };
  if (isWkday) {
    try {
      const poll = await prisma.poll.findUnique({
        where: { date_mealType: { date: businessDate, mealType: "LUNCH" } },
        include: { votes: true },
      });
      if (poll) {
        const collegeVotes = (poll.votes || []).filter((v) => v.location === "COLLEGE").length;
        const restVotes = (poll.votes || []).filter((v) => v.location === "RESTAURANT").length;
        pollInfo = {
          available: true,
          votes: (poll.votes || []).length,
          college: collegeVotes,
          restaurant: restVotes,
        };
      } else {
        pollInfo = { available: true, votes: 0, college: 0, restaurant: 0 };
      }
    } catch {
      pollInfo = { available: true, votes: 0, college: 0, restaurant: 0 };
    }
  }

  return {
    date: effectiveStr,
    dayOfWeek: ist.dayName,
    lunch: {
      available: true,
      present: lunchAtt.present,
      absent: lunchAtt.absent,
      unmarked: lunchAtt.unmarked,
      restaurant: lunchAtt.restaurant,
      college: lunchAtt.college,
      tokens: lunchTokenCount,
    },
    dinner: {
      available: !isSun,
      present: isSun ? 0 : dinnerAtt.present,
      absent: isSun ? 0 : dinnerAtt.absent,
      unmarked: isSun ? 0 : dinnerAtt.unmarked,
      restaurant: isSun ? 0 : dinnerAtt.restaurant,
      college: 0,
      tokens: isSun ? 0 : dinnerTokenCount,
    },
    tiffinsConsumed: lunchTokenCount + (isSun ? 0 : dinnerTokenCount),
    poll: pollInfo,
  };
}
