import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import { getBusinessDate, getNow } from "../utils/businessTime.js";

/**
 * Centralized service to evaluate customer service status and eligibility.
 * Evaluates both Service Suspension (calendar date range) and Payment Suspension (balance <= 0).
 *
 * @param {string} customerId - CustomerProfile ID
 * @param {Date|string} [date] - Evaluation date (defaults to current time)
 * @returns {Promise<{
 *   customerId: string,
 *   serviceStatus: "ACTIVE" | "SERVICE_SUSPENDED" | "PAYMENT_SUSPENDED",
 *   isServiceSuspended: boolean,
 *   isPaymentSuspended: boolean,
 *   isEligibleForService: boolean,
 *   remainingTiffins: number,
 *   activeSuspension: object | null,
 *   reasons: string[]
 * }>}
 */
export async function getCustomerServiceStatus(customerId, date = getNow()) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  const customer = await prisma.customerProfile.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
  }

  const businessDate = getBusinessDate(date);

  // Check for active service suspension covering businessDate inclusively
  let activeSuspension = null;
  try {
    activeSuspension = await prisma.serviceSuspension.findFirst({
      where: {
        customerId,
        startDate: { lte: businessDate },
        endDate: { gte: businessDate },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    if (err.name === "PrismaClientInitializationError") {
      activeSuspension = null;
    } else {
      throw err;
    }
  }

  const isServiceSuspended = !!activeSuspension;
  const isPaymentSuspended = customer.remainingTiffins <= 0;
  const isEligibleForService = !isServiceSuspended && !isPaymentSuspended;

  // Prioritize primary status display while preserving independent flags
  let serviceStatus = "ACTIVE";
  if (isServiceSuspended) {
    serviceStatus = "SERVICE_SUSPENDED";
  } else if (isPaymentSuspended) {
    serviceStatus = "PAYMENT_SUSPENDED";
  }

  const reasons = [];
  if (isServiceSuspended) {
    reasons.push(activeSuspension.reason || "Customer service is currently suspended for this date.");
  }
  if (isPaymentSuspended) {
    reasons.push("Customer has zero remaining tiffins (payment suspended).");
  }

  return {
    customerId,
    serviceStatus,
    isServiceSuspended,
    isPaymentSuspended,
    isEligibleForService,
    remainingTiffins: customer.remainingTiffins,
    activeSuspension: activeSuspension || null,
    reasons,
  };
}
