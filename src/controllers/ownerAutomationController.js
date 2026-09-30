import {
  finalizeLunchForDate,
  finalizeDinnerForDate,
} from "../services/dailyFinalizationService.js";
import { getSchedulerStatus } from "../scheduler/dailyScheduler.js";
import { parseBusinessDate, getNow } from "../utils/businessTime.js";

/**
 * Handles POST /api/owner/automation/finalize-lunch
 * Manually triggers lunch finalization for development / testing.
 */
export async function finalizeLunch(req, res, next) {
  try {
    const { date, enforceTimeWindow } = req.body || {};
    const targetDate = date ? parseBusinessDate(date) : getNow();

    const summary = await finalizeLunchForDate(targetDate, {
      enforceTimeWindow: !!enforceTimeWindow,
    });

    return res.status(200).json({
      message: "Lunch finalization processed successfully.",
      summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles POST /api/owner/automation/finalize-dinner
 * Manually triggers dinner finalization for development / testing.
 */
export async function finalizeDinner(req, res, next) {
  try {
    const { date, enforceTimeWindow } = req.body || {};
    const targetDate = date ? parseBusinessDate(date) : getNow();

    const summary = await finalizeDinnerForDate(targetDate, {
      enforceTimeWindow: !!enforceTimeWindow,
    });

    return res.status(200).json({
      message: "Dinner finalization processed successfully.",
      summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles GET /api/owner/automation/status
 * Returns current daily automation scheduler status.
 */
export async function getSchedulerInfo(req, res, next) {
  try {
    const status = getSchedulerStatus();
    return res.status(200).json({
      scheduler: status,
    });
  } catch (error) {
    next(error);
  }
}
