import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import { getBusinessDate } from "../utils/businessTime.js";
import { formatSafeCustomer } from "./customerService.js";

/**
 * Recharges a customer's tiffin balance with cash.
 * Atomically updates balance, writes CASH_RECHARGE ledger transaction, and clears PAYMENT_SUSPENDED.
 */
export async function rechargeCustomer(customerId, { amount, tiffins, reason }, actorId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  const rawAmount = amount !== undefined ? amount : tiffins;
  const parsedAmount = Number(rawAmount);

  if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
    throw ApiError.badRequest("Recharge amount must be a positive integer greater than zero.");
  }

  const cleanReason = reason && typeof reason === "string" ? reason.trim() : `Owner cash recharge: +${parsedAmount} tiffins`;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch current profile
    const existing = await tx.customerProfile.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            id: true,
            loginIdentifier: true,
            role: true,
          },
        },
      },
    });

    if (!existing) {
      throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
    }

    const previousBalance = existing.remainingTiffins;
    const newBalance = previousBalance + parsedAmount;
    const todayDate = getBusinessDate();

    // Check if customer has an active service suspension for today
    const activeSuspension = await tx.serviceSuspension.findFirst({
      where: {
        customerId,
        startDate: { lte: todayDate },
        endDate: { gte: todayDate },
      },
    });

    // If customer was payment suspended, clear it unless currently service-suspended
    let updatedStatus = existing.serviceStatus;
    if (activeSuspension) {
      updatedStatus = "SERVICE_SUSPENDED";
    } else {
      updatedStatus = "ACTIVE";
    }

    // 2. Atomic balance update
    const updatedProfile = await tx.customerProfile.update({
      where: { id: customerId },
      data: {
        remainingTiffins: { increment: parsedAmount },
        serviceStatus: updatedStatus,
      },
      include: {
        user: {
          select: {
            id: true,
            loginIdentifier: true,
            role: true,
          },
        },
      },
    });

    // 3. Create CASH_RECHARGE TiffinTransaction
    const transaction = await tx.tiffinTransaction.create({
      data: {
        customerId,
        quantity: parsedAmount,
        type: "CASH_RECHARGE",
        reason: cleanReason,
        createdBy: actorId || null,
      },
    });

    // 4. Create AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_CASH_RECHARGE",
        entityType: "CustomerProfile",
        entityId: customerId,
        metadata: {
          customerId,
          rechargeAmount: parsedAmount,
          previousBalance,
          newBalance,
          transactionId: transaction.id,
          reason: cleanReason,
        },
      },
    });

    return {
      customer: formatSafeCustomer(updatedProfile),
      transaction,
    };
  });

  return {
    message: "Tiffin balance recharged successfully.",
    customer: result.customer,
    transaction: result.transaction,
  };
}
