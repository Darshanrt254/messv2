import ExcelJS from "exceljs";
import prisma from "../config/prisma.js";
import {
  getNow,
  getBusinessDate,
  parseBusinessDate,
  getISTComponents,
  isSunday,
  isSaturday,
  parseDateRange,
  getBusinessDatesList,
  formatISTDate,
  formatISTDateTime,
} from "../utils/businessTime.js";

/**
 * Styles a worksheet header row with dark theme, bold text, center alignment,
 * frozen top row, and autoFilter.
 *
 * @param {ExcelJS.Worksheet} sheet
 */
function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // dark slate / navy
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 26;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  // Light border for all cells in header
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      right: { style: "thin", color: { argb: "FF334155" } },
    };
  });
}

/**
 * Formats a status/enum string to Title Case.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  if (!str) return "-";
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Generates an Excel (XLSX) workbook containing all 7 required operational sheets
 * for the requested business-date range in Asia/Kolkata.
 *
 * Strictly READ-ONLY: Never modifies balances, attendance, tokens, polls, or messages.
 *
 * @param {object} params
 * @param {string} [params.from] - Business date start (YYYY-MM-DD)
 * @param {string} [params.to] - Business date end (YYYY-MM-DD)
 * @returns {Promise<{ buffer: Buffer, filename: string, range: object }>}
 */
export async function generateOperationalXlsx({ from: fromStr, to: toStr } = {}) {
  const range = parseDateRange(fromStr, toStr);
  const todayBusinessDate = getBusinessDate(getNow());

  // 1. Efficient Bounded Database Queries (Zero N+1)
  const [
    attendances,
    customers,
    transactions,
    pollVotes,
    messages,
    tokens,
    newCustomers,
  ] = await Promise.all([
    // Attendance records in range
    prisma.attendance.findMany({
      where: {
        date: {
          gte: range.fromDate,
          lte: range.toDate,
        },
      },
      include: {
        customer: {
          select: { id: true, name: true, phone: true },
        },
        mealToken: {
          select: { token: true },
        },
      },
      orderBy: [{ date: "asc" }, { mealType: "asc" }, { customer: { name: "asc" } }],
    }),

    // All current customers (excluding sensitive passwordHash/tokens)
    prisma.customerProfile.findMany({
      include: {
        serviceSuspensions: {
          where: {
            startDate: { lte: todayBusinessDate },
            endDate: { gte: todayBusinessDate },
          },
        },
      },
      orderBy: { name: "asc" },
    }),

    // Tiffin Transactions in timestamp range
    prisma.tiffinTransaction.findMany({
      where: {
        createdAt: {
          gte: range.fromTimestamp,
          lt: range.toTimestampExclusive,
        },
      },
      include: {
        customer: {
          select: { name: true, phone: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),

    // Poll Votes in date range
    prisma.pollVote.findMany({
      where: {
        poll: {
          date: {
            gte: range.fromDate,
            lte: range.toDate,
          },
        },
      },
      include: {
        poll: true,
        customer: {
          select: { name: true, phone: true },
        },
      },
      orderBy: [{ poll: { date: "asc" } }, { createdAt: "asc" }],
    }),

    // Messages in timestamp range
    prisma.message.findMany({
      where: {
        createdAt: {
          gte: range.fromTimestamp,
          lt: range.toTimestampExclusive,
        },
      },
      include: {
        customer: {
          select: { name: true, phone: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),

    // Meal Tokens in date range
    prisma.mealToken.findMany({
      where: {
        date: {
          gte: range.fromDate,
          lte: range.toDate,
        },
      },
      include: {
        attendance: {
          include: {
            customer: {
              select: { name: true, phone: true },
            },
          },
        },
      },
      orderBy: [{ date: "asc" }, { token: "asc" }],
    }),

    // New customers created in timestamp range
    prisma.customerProfile.findMany({
      where: {
        createdAt: {
          gte: range.fromTimestamp,
          lt: range.toTimestampExclusive,
        },
      },
      select: { id: true, createdAt: true },
    }),
  ]);

  // 2. Initialize Workbook & Metadata
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swayamsiddha Mess System";
  workbook.created = getNow();
  workbook.properties.date1904 = false;
  workbook.title = `Swayamsiddha Operational Report (${range.from} to ${range.to})`;
  workbook.description = `Generated at ${formatISTDateTime(getNow())} for business date range ${range.from} to ${range.to} IST`;

  // =========================================================================
  // SHEET 1: Attendance
  // =========================================================================
  const attSheet = workbook.addWorksheet("Attendance", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  attSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Meal", key: "meal", width: 12 },
    { header: "Attendance Status", key: "status", width: 18 },
    { header: "Meal Location", key: "location", width: 16 },
    { header: "Source", key: "source", width: 16 },
    { header: "Token", key: "token", width: 22 },
    { header: "Created At", key: "createdAt", width: 24 },
    { header: "Updated At", key: "updatedAt", width: 24 },
  ];
  styleHeaderRow(attSheet);

  for (const a of attendances) {
    attSheet.addRow({
      date: formatISTDate(a.date),
      customerName: a.customer?.name || "-",
      phone: a.customer?.phone || "-",
      meal: a.mealType === "LUNCH" ? "Lunch" : "Dinner",
      status: toTitleCase(a.status),
      location: a.status === "PRESENT" ? toTitleCase(a.location) : "-",
      source: toTitleCase(a.source),
      token: a.mealToken?.token || "-",
      createdAt: formatISTDateTime(a.createdAt),
      updatedAt: formatISTDateTime(a.updatedAt),
    });
  }

  // =========================================================================
  // SHEET 2: Customers
  // =========================================================================
  const custSheet = workbook.addWorksheet("Customers", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  custSheet.columns = [
    { header: "Customer ID", key: "id", width: 38 },
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Remaining Tiffins", key: "remainingTiffins", width: 18 },
    { header: "Service Status", key: "serviceStatus", width: 20 },
    { header: "Payment Status", key: "paymentStatus", width: 22 },
    { header: "Overall Status", key: "overallStatus", width: 32 },
    { header: "Account Created At", key: "createdAt", width: 24 },
  ];
  styleHeaderRow(custSheet);

  for (const c of customers) {
    const isServiceSuspended = (c.serviceSuspensions?.length || 0) > 0;
    const isPaymentSuspended = c.remainingTiffins <= 0;

    let overallStatus = "ACTIVE";
    if (isServiceSuspended && isPaymentSuspended) {
      overallStatus = "SERVICE & PAYMENT SUSPENDED";
    } else if (isServiceSuspended) {
      overallStatus = "SERVICE_SUSPENDED";
    } else if (isPaymentSuspended) {
      overallStatus = "PAYMENT_SUSPENDED";
    }

    custSheet.addRow({
      id: c.id,
      name: c.name,
      phone: c.phone,
      remainingTiffins: c.remainingTiffins,
      serviceStatus: isServiceSuspended ? "SERVICE_SUSPENDED" : "ACTIVE",
      paymentStatus: isPaymentSuspended ? "PAYMENT_SUSPENDED" : "ACTIVE",
      overallStatus,
      createdAt: formatISTDateTime(c.createdAt),
    });
  }

  // =========================================================================
  // SHEET 3: Tiffin Transactions
  // =========================================================================
  const txSheet = workbook.addWorksheet("Tiffin Transactions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  txSheet.columns = [
    { header: "Transaction ID", key: "id", width: 38 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Date / Time", key: "dateTime", width: 24 },
    { header: "Type", key: "type", width: 20 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Signed Quantity", key: "signedQuantity", width: 16 },
    { header: "Reference", key: "reference", width: 30 },
    { header: "Created At", key: "createdAt", width: 24 },
  ];
  styleHeaderRow(txSheet);

  for (const tx of transactions) {
    txSheet.addRow({
      id: tx.id,
      customerName: tx.customer?.name || "-",
      phone: tx.customer?.phone || "-",
      dateTime: formatISTDateTime(tx.createdAt),
      type: tx.type,
      quantity: Math.abs(tx.quantity),
      signedQuantity: tx.quantity,
      reference: tx.reference || "-",
      createdAt: formatISTDateTime(tx.createdAt),
    });
  }

  // =========================================================================
  // SHEET 4: Poll Results
  // =========================================================================
  const pollSheet = workbook.addWorksheet("Poll Results", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  pollSheet.columns = [
    { header: "Poll Date", key: "pollDate", width: 14 },
    { header: "Meal", key: "meal", width: 12 },
    { header: "Poll Status", key: "pollStatus", width: 14 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Vote", key: "vote", width: 16 },
    { header: "Vote Created At", key: "createdAt", width: 24 },
  ];
  styleHeaderRow(pollSheet);

  for (const v of pollVotes) {
    pollSheet.addRow({
      pollDate: formatISTDate(v.poll?.date),
      meal: v.poll?.mealType === "LUNCH" ? "Lunch" : (v.poll?.mealType || "-"),
      pollStatus: v.poll?.status || "-",
      customerName: v.customer?.name || "-",
      phone: v.customer?.phone || "-",
      vote: toTitleCase(v.location),
      createdAt: formatISTDateTime(v.createdAt),
    });
  }

  // =========================================================================
  // SHEET 5: Messages
  // =========================================================================
  const msgSheet = workbook.addWorksheet("Messages", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  msgSheet.columns = [
    { header: "Message ID", key: "id", width: 38 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Message Content", key: "content", width: 44 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "createdAt", width: 24 },
    { header: "Read At", key: "readAt", width: 24 },
    { header: "Resolved At", key: "resolvedAt", width: 24 },
  ];
  styleHeaderRow(msgSheet);

  for (const m of messages) {
    msgSheet.addRow({
      id: m.id,
      customerName: m.customer?.name || "-",
      phone: m.customer?.phone || "-",
      content: m.content,
      status: m.status,
      createdAt: formatISTDateTime(m.createdAt),
      readAt: formatISTDateTime(m.readAt),
      resolvedAt: formatISTDateTime(m.resolvedAt),
    });
  }

  // =========================================================================
  // SHEET 6: Meal Tokens
  // =========================================================================
  const tokenSheet = workbook.addWorksheet("Meal Tokens", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  tokenSheet.columns = [
    { header: "Token", key: "token", width: 22 },
    { header: "Date", key: "date", width: 14 },
    { header: "Customer Name", key: "customerName", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Meal", key: "meal", width: 12 },
    { header: "Location", key: "location", width: 16 },
    { header: "Attendance ID", key: "attendanceId", width: 38 },
    { header: "Created At", key: "createdAt", width: 24 },
  ];
  styleHeaderRow(tokenSheet);

  for (const t of tokens) {
    tokenSheet.addRow({
      token: t.token,
      date: formatISTDate(t.date),
      customerName: t.attendance?.customer?.name || "-",
      phone: t.attendance?.customer?.phone || "-",
      meal: t.mealType === "LUNCH" ? "Lunch" : "Dinner",
      location: toTitleCase(t.location),
      attendanceId: t.attendanceId,
      createdAt: formatISTDateTime(t.createdAt),
    });
  }

  // =========================================================================
  // SHEET 7: Daily Summary
  // =========================================================================
  const summarySheet = workbook.addWorksheet("Daily Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  summarySheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Day", key: "day", width: 14 },
    { header: "Lunch Present", key: "lunchPresent", width: 15 },
    { header: "Lunch Absent", key: "lunchAbsent", width: 15 },
    { header: "Dinner Present", key: "dinnerPresent", width: 15 },
    { header: "Dinner Absent", key: "dinnerAbsent", width: 15 },
    { header: "Lunch Restaurant", key: "lunchRestaurant", width: 17 },
    { header: "Lunch College", key: "lunchCollege", width: 15 },
    { header: "Dinner Restaurant", key: "dinnerRestaurant", width: 17 },
    { header: "Meals Consumed", key: "mealsConsumed", width: 16 },
    { header: "Tiffins Added", key: "tiffinsAdded", width: 15 },
    { header: "Tiffins Consumed", key: "tiffinsConsumed", width: 16 },
    { header: "Net Tiffin Change", key: "netTiffinChange", width: 18 },
    { header: "Poll Votes", key: "pollVotes", width: 14 },
    { header: "Messages", key: "messages", width: 14 },
    { header: "New Customers", key: "newCustomers", width: 15 },
  ];
  styleHeaderRow(summarySheet);

  const datesList = getBusinessDatesList(range.from, range.to);

  // Totals accumulator for summary row
  const totals = {
    lunchPresent: 0,
    lunchAbsent: 0,
    dinnerPresent: 0,
    dinnerAbsent: 0,
    lunchRestaurant: 0,
    lunchCollege: 0,
    dinnerRestaurant: 0,
    mealsConsumed: 0,
    tiffinsAdded: 0,
    tiffinsConsumed: 0,
    netTiffinChange: 0,
    pollVotes: 0,
    messages: 0,
    newCustomers: 0,
  };

  for (const dateStr of datesList) {
    const businessDate = parseBusinessDate(dateStr);
    const istComp = getISTComponents(businessDate);
    const isSun = isSunday(businessDate);
    const isSat = isSaturday(businessDate);

    // Attendance for date
    const dayAtts = attendances.filter((a) => formatISTDate(a.date) === dateStr);
    const lunchPresent = dayAtts.filter((a) => a.mealType === "LUNCH" && a.status === "PRESENT").length;
    const lunchAbsent = dayAtts.filter((a) => a.mealType === "LUNCH" && a.status === "ABSENT").length;
    const dinnerPresent = isSun
      ? 0
      : dayAtts.filter((a) => a.mealType === "DINNER" && a.status === "PRESENT").length;
    const dinnerAbsent = isSun
      ? 0
      : dayAtts.filter((a) => a.mealType === "DINNER" && a.status === "ABSENT").length;

    const lunchRestaurant = dayAtts.filter(
      (a) => a.mealType === "LUNCH" && a.status === "PRESENT" && a.location === "RESTAURANT"
    ).length;
    const lunchCollege = dayAtts.filter(
      (a) => a.mealType === "LUNCH" && a.status === "PRESENT" && a.location === "COLLEGE"
    ).length;
    const dinnerRestaurant = isSun
      ? 0
      : dayAtts.filter(
          (a) => a.mealType === "DINNER" && a.status === "PRESENT" && a.location === "RESTAURANT"
        ).length;

    // Tokens for date (authoritative meal consumption)
    const dayTokens = tokens.filter((t) => formatISTDate(t.date) === dateStr);
    const mealsConsumed = isSun
      ? dayTokens.filter((t) => t.mealType === "LUNCH").length
      : dayTokens.length;

    // Transactions for date (IST timestamp matching)
    const dayTxs = transactions.filter((tx) => formatISTDate(tx.createdAt) === dateStr);
    let tiffinsAdded = 0;
    let tiffinsConsumed = 0;
    let netTiffinChange = 0;

    for (const tx of dayTxs) {
      if (tx.type === "INITIAL_BALANCE" || tx.type === "CASH_RECHARGE") {
        tiffinsAdded += Math.abs(tx.quantity);
      } else if (tx.type === "MEAL_TOKEN") {
        tiffinsConsumed += Math.abs(tx.quantity);
      }
      netTiffinChange += tx.quantity;
    }

    // Poll votes for date (weekday only, no Saturday, no Sunday)
    const dayVotes = (isSun || isSat)
      ? 0
      : pollVotes.filter((v) => formatISTDate(v.poll?.date) === dateStr).length;

    // Messages created on date
    const dayMsgs = messages.filter((m) => formatISTDate(m.createdAt) === dateStr).length;

    // New customers created on date
    const dayNewCusts = newCustomers.filter((c) => formatISTDate(c.createdAt) === dateStr).length;

    // Update totals
    totals.lunchPresent += lunchPresent;
    totals.lunchAbsent += lunchAbsent;
    totals.dinnerPresent += dinnerPresent;
    totals.dinnerAbsent += dinnerAbsent;
    totals.lunchRestaurant += lunchRestaurant;
    totals.lunchCollege += lunchCollege;
    totals.dinnerRestaurant += dinnerRestaurant;
    totals.mealsConsumed += mealsConsumed;
    totals.tiffinsAdded += tiffinsAdded;
    totals.tiffinsConsumed += tiffinsConsumed;
    totals.netTiffinChange += netTiffinChange;
    totals.pollVotes += dayVotes;
    totals.messages += dayMsgs;
    totals.newCustomers += dayNewCusts;

    summarySheet.addRow({
      date: dateStr,
      day: toTitleCase(istComp.dayName),
      lunchPresent,
      lunchAbsent,
      dinnerPresent,
      dinnerAbsent,
      lunchRestaurant,
      lunchCollege,
      dinnerRestaurant,
      mealsConsumed,
      tiffinsAdded,
      tiffinsConsumed,
      netTiffinChange,
      pollVotes: dayVotes,
      messages: dayMsgs,
      newCustomers: dayNewCusts,
    });
  }

  // Add Summary Total row at the bottom if dates list has entries
  if (datesList.length > 0) {
    const totalRow = summarySheet.addRow({
      date: "TOTAL",
      day: `${datesList.length} Day(s)`,
      lunchPresent: totals.lunchPresent,
      lunchAbsent: totals.lunchAbsent,
      dinnerPresent: totals.dinnerPresent,
      dinnerAbsent: totals.dinnerAbsent,
      lunchRestaurant: totals.lunchRestaurant,
      lunchCollege: totals.lunchCollege,
      dinnerRestaurant: totals.dinnerRestaurant,
      mealsConsumed: totals.mealsConsumed,
      tiffinsAdded: totals.tiffinsAdded,
      tiffinsConsumed: totals.tiffinsConsumed,
      netTiffinChange: totals.netTiffinChange,
      pollVotes: totals.pollVotes,
      messages: totals.messages,
      newCustomers: totals.newCustomers,
    });

    totalRow.font = { bold: true };
    totalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" }, // light gray/slate
    };
    totalRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "double", color: { argb: "FF0F172A" } },
      };
    });
  }

  // 3. Write Buffer
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `swayamsiddha-report-${range.from}-to-${range.to}.xlsx`;

  return {
    buffer: Buffer.from(buffer),
    filename,
    range,
  };
}
