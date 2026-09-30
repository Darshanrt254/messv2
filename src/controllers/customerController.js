import * as customerService from "../services/customerService.js";

/**
 * Handles GET /api/customer/me
 * Retrieves authenticated customer's own profile based on req.user.id.
 */
export async function getMe(req, res, next) {
  try {
    const profile = await customerService.getCustomerProfileByUserId(req.user.id);
    return res.status(200).json({
      customer: profile,
    });
  } catch (error) {
    next(error);
  }
}
