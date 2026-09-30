import * as attendanceService from "../services/attendanceService.js";

/**
 * Handles GET /api/owner/attendance
 * Lists operational attendance records for OWNER.
 */
export async function list(req, res, next) {
  try {
    const { date, customerId, mealType, status } = req.query || {};
    const records = await attendanceService.listAttendanceForOwner({
      date,
      customerId,
      mealType,
      status,
    });

    return res.status(200).json({
      attendance: records,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles PATCH /api/owner/attendance/:attendanceId
 * Allows OWNER to manually correct an attendance record with audit logging.
 */
export async function update(req, res, next) {
  try {
    const { attendanceId } = req.params;
    const { status, location } = req.body || {};

    const updated = await attendanceService.updateAttendanceByOwner(
      attendanceId,
      { status, location },
      req.user.id
    );

    return res.status(200).json({
      message: "Attendance updated successfully",
      attendance: updated,
    });
  } catch (error) {
    next(error);
  }
}
