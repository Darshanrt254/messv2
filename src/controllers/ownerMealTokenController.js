import { generateMealToken } from "../services/mealTokenService.js";

/**
 * Controller to handle OWNER manual/operational meal token generation for an attendance record.
 */
export async function createToken(req, res, next) {
  try {
    const { attendanceId } = req.params;
    const actorId = req.user?.id || null;

    const result = await generateMealToken({ attendanceId, actorId });

    const statusCode = result.isNew ? 201 : 200;

    return res.status(statusCode).json({
      message: result.isNew
        ? "Meal token generated successfully."
        : "Existing meal token returned.",
      isNew: result.isNew,
      mealToken: result.mealToken,
    });
  } catch (error) {
    next(error);
  }
}
