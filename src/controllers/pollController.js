import prisma from "../config/prisma.js";
import * as pollService from "../services/pollService.js";
import ApiError from "../utils/apiError.js";

/**
 * Helper to fetch customer profile ID from req.user.id.
 */
async function getCustomerProfileId(userId) {
  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }
  return profile.id;
}

/**
 * Handles GET /api/customer/poll/today
 * Retrieves today's lunch location poll status and customer eligibility.
 */
export async function getTodayPoll(req, res, next) {
  try {
    const customerId = await getCustomerProfileId(req.user.id);
    const pollState = await pollService.getPollForCustomer(customerId);
    return res.status(200).json(pollState);
  } catch (error) {
    next(error);
  }
}

/**
 * Handles POST /api/customer/poll/vote
 * Casts customer's vote in today's lunch location poll.
 */
export async function vote(req, res, next) {
  try {
    const customerId = await getCustomerProfileId(req.user.id);
    const { location } = req.body || {};

    const result = await pollService.voteInPoll({
      customerId,
      location,
    });

    return res.status(200).json({
      message: "Vote recorded successfully",
      result,
    });
  } catch (error) {
    next(error);
  }
}
