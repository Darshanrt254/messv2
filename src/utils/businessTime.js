/**
 * Centralized Timezone & Business Calendar Utilities
 * All business operations for Swayamsiddha operate strictly in Asia/Kolkata (IST: UTC+5:30).
 */

import ApiError from "./apiError.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds

let mockNow = null;

/**
 * Sets a deterministic mock time for testing.
 * @param {string|Date|null} dateOrIso
 */
export function setMockTime(dateOrIso) {
  mockNow = dateOrIso ? new Date(dateOrIso) : null;
}

/**
 * Resets any active mock time.
 */
export function resetMockTime() {
  mockNow = null;
}

/**
 * Gets the current timestamp (respecting any mock time set).
 * @returns {Date}
 */
export function getNow() {
  return mockNow ? new Date(mockNow) : new Date();
}

/**
 * Computes calendar components in Asia/Kolkata (IST).
 * @param {Date} [date] Defaults to getNow()
 */
export function getISTComponents(date = getNow()) {
  const d = date instanceof Date ? date : new Date(date);
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);

  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const seconds = shifted.getUTCSeconds();
  const dayOfWeek = shifted.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  const DAY_NAMES = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];

  const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    dateString,
  };
}

/**
 * Returns a normalized Date object at midnight UTC corresponding to the IST calendar date.
 * Used for storing and querying Prisma @db.Date fields deterministically.
 * @param {Date} [date]
 * @returns {Date}
 */
export function getBusinessDate(date = getNow()) {
  const { year, month, day } = getISTComponents(date);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Parses a "YYYY-MM-DD" date string into midnight UTC Date for @db.Date comparison.
 * @param {string} dateString
 * @returns {Date}
 */
export function parseBusinessDate(dateString) {
  if (!dateString || typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Invalid business date string format: '${dateString}'. Expected 'YYYY-MM-DD'.`);
  }
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Checks whether the specified date is a Monday-Friday weekday in IST.
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isWeekday(date = getNow()) {
  const { dayOfWeek } = getISTComponents(date);
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Checks whether the specified date is Saturday in IST.
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isSaturday(date = getNow()) {
  const { dayOfWeek } = getISTComponents(date);
  return dayOfWeek === 6;
}

/**
 * Checks whether the specified date is Sunday in IST.
 * @param {Date} [date]
 * @returns {boolean}
 */
export function isSunday(date = getNow()) {
  const { dayOfWeek } = getISTComponents(date);
  return dayOfWeek === 0;
}

/**
 * Computes the lunch poll window (06:00 IST to 11:30 IST) for the business date.
 * @param {Date} [date]
 */
export function getLunchPollWindow(date = getNow()) {
  const comp = getISTComponents(date);
  const currentTime = (date instanceof Date ? date : new Date(date)).getTime();

  // 06:00 IST = 00:30 UTC
  const opensAt = new Date(Date.UTC(comp.year, comp.month - 1, comp.day, 0, 30, 0, 0));
  // 11:30 IST = 06:00 UTC
  const closesAt = new Date(Date.UTC(comp.year, comp.month - 1, comp.day, 6, 0, 0, 0));

  const isBeforeOpen = currentTime < opensAt.getTime();
  const isAfterClose = currentTime >= closesAt.getTime();
  const isOpen = currentTime >= opensAt.getTime() && currentTime < closesAt.getTime();

  return {
    opensAt,
    closesAt,
    isOpen,
    isBeforeOpen,
    isAfterClose,
  };
}

/**
 * Validates that a string is a valid YYYY-MM-DD calendar date.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDateString(dateStr) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Converts a business date string (YYYY-MM-DD) to its IST day boundaries in UTC timestamps.
 * 00:00:00 IST = UTC - 5:30
 * @param {string} dateString
 * @returns {{ start: Date, endExclusive: Date }}
 */
export function getISTDayTimestampRange(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS);
  const endExclusive = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - IST_OFFSET_MS);
  return { start, endExclusive };
}

/**
 * Validates and normalizes date range parameters (from, to).
 * If omitted, defaults both to today's business date.
 *
 * @param {string} [fromStr]
 * @param {string} [toStr]
 * @returns {{
 *   from: string,
 *   to: string,
 *   fromDate: Date,
 *   toDate: Date,
 *   fromTimestamp: Date,
 *   toTimestampExclusive: Date
 * }}
 */
export function parseDateRange(fromStr, toStr) {
  const todayStr = getISTComponents(getNow()).dateString;

  if (toStr && !fromStr) {
    throw ApiError.badRequest("Missing 'from' date parameter when 'to' date is specified.");
  }

  const from = fromStr || todayStr;
  const to = toStr || from;

  if (!isValidDateString(from)) {
    throw ApiError.badRequest(`Invalid 'from' date format: '${fromStr}'. Expected YYYY-MM-DD.`);
  }
  if (!isValidDateString(to)) {
    throw ApiError.badRequest(`Invalid 'to' date format: '${toStr}'. Expected YYYY-MM-DD.`);
  }
  if (from > to) {
    throw ApiError.badRequest(`Invalid date range: 'from' date (${from}) must be on or before 'to' date (${to}).`);
  }

  const fromDate = parseBusinessDate(from);
  const toDate = parseBusinessDate(to);
  const { start: fromTimestamp } = getISTDayTimestampRange(from);
  const { endExclusive: toTimestampExclusive } = getISTDayTimestampRange(to);

  return {
    from,
    to,
    fromDate,
    toDate,
    fromTimestamp,
    toTimestampExclusive,
  };
}

/**
 * Returns an array of YYYY-MM-DD date strings inclusive from start to end.
 * @param {string} fromStr
 * @param {string} toStr
 * @returns {string[]}
 */
export function getBusinessDatesList(fromStr, toStr) {
  const dates = [];
  let curr = parseBusinessDate(fromStr);
  const end = parseBusinessDate(toStr);

  while (curr.getTime() <= end.getTime()) {
    dates.push(getISTComponents(curr).dateString);
    curr = new Date(curr.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

/**
 * Formats a Date object or business date into YYYY-MM-DD in IST.
 * @param {Date|string|null} date
 * @returns {string}
 */
export function formatISTDate(date) {
  if (!date) return "-";
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const { dateString } = getISTComponents(date);
  return dateString;
}

/**
 * Formats a timestamp into human-readable IST datetime string (YYYY-MM-DD HH:mm:ss IST).
 * @param {Date|string|null} date
 * @returns {string}
 */
export function formatISTDateTime(date) {
  if (!date) return "-";
  const { year, month, day, hours, minutes, seconds } = getISTComponents(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)} IST`;
}

