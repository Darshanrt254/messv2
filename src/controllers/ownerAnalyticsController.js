import * as analyticsService from "../services/analyticsService.js";

/**
 * GET /api/owner/analytics/overview
 */
export async function getOverview(req, res, next) {
  try {
    const data = await analyticsService.getOverviewAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/attendance
 */
export async function getAttendance(req, res, next) {
  try {
    const data = await analyticsService.getAttendanceAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/locations
 */
export async function getLocations(req, res, next) {
  try {
    const data = await analyticsService.getLocationAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/meals
 */
export async function getMeals(req, res, next) {
  try {
    const data = await analyticsService.getMealConsumptionAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/tiffins
 */
export async function getTiffins(req, res, next) {
  try {
    const data = await analyticsService.getTiffinLedgerAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/balances
 */
export async function getBalances(req, res, next) {
  try {
    const data = await analyticsService.getBalanceAnalytics();
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/customer-status
 */
export async function getCustomerStatus(req, res, next) {
  try {
    const data = await analyticsService.getCustomerStatusAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/suspensions
 */
export async function getSuspensions(req, res, next) {
  try {
    const data = await analyticsService.getSuspensionAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/polls
 */
export async function getPolls(req, res, next) {
  try {
    const data = await analyticsService.getPollAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/messages
 */
export async function getMessages(req, res, next) {
  try {
    const data = await analyticsService.getMessageAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/tokens
 */
export async function getTokens(req, res, next) {
  try {
    const data = await analyticsService.getTokenAnalytics(req.query);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/owner/analytics/daily
 */
export async function getDaily(req, res, next) {
  try {
    const data = await analyticsService.getDailyOperationalSummary(req.query.date);
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
}
