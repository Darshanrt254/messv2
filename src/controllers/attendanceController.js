import * as attendanceService from "../services/attendanceService.js";

/**
 * Handles GET /api/customer/meals/today
 * Retrieves today's meal and attendance state for the authenticated customer.
 */
export async function getTodayMealState(req, res, next) {
  try {
    const mealState = await attendanceService.getCustomerTodayMealState(req.user.id);
    return res.status(200).json(mealState);
  } catch (error) {
    next(error);
  }
}

/**
 * Handles POST /api/customer/attendance
 * Confirms customer attendance for lunch or dinner.
 */
export async function markAttendance(req, res, next) {
  try {
    const { mealType, status } = req.body || {};
    const attendance = await attendanceService.markCustomerAttendance(req.user.id, {
      mealType,
      status,
    });

    return res.status(200).json({
      message: "Attendance confirmed successfully",
      attendance,
    });
  } catch (error) {
    next(error);
  }
}
