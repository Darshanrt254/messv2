import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import { parseBusinessDate, getBusinessDate, getNow } from "../utils/businessTime.js";

/**
 * Creates a new service suspension date range for a customer.
 */
export async function createSuspension(customerId, { startDate, endDate, reason }, actorId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  if (!startDate || !endDate) {
    throw ApiError.badRequest("Start date and end date are required.");
  }

  const customer = await prisma.customerProfile.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
  }

  let parsedStart;
  let parsedEnd;
  try {
    parsedStart = parseBusinessDate(startDate);
    parsedEnd = parseBusinessDate(endDate);
  } catch (err) {
    throw ApiError.badRequest(err.message);
  }

  if (parsedEnd.getTime() < parsedStart.getTime()) {
    throw ApiError.badRequest("End date cannot be earlier than start date.");
  }

  // Check for overlapping active suspensions for this customer
  const overlapping = await prisma.serviceSuspension.findFirst({
    where: {
      customerId,
      startDate: { lte: parsedEnd },
      endDate: { gte: parsedStart },
    },
  });

  if (overlapping) {
    throw ApiError.conflict("An active service suspension already exists overlapping this date range.");
  }

  const todayDate = getBusinessDate();
  const cleanReason = reason && typeof reason === "string" ? reason.trim() : null;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create ServiceSuspension record
    const suspension = await tx.serviceSuspension.create({
      data: {
        customerId,
        startDate: parsedStart,
        endDate: parsedEnd,
        reason: cleanReason,
        createdBy: actorId || null,
      },
    });

    // 2. Update CustomerProfile serviceStatus if suspension covers current date
    if (parsedStart.getTime() <= todayDate.getTime() && parsedEnd.getTime() >= todayDate.getTime()) {
      await tx.customerProfile.update({
        where: { id: customerId },
        data: { serviceStatus: "SERVICE_SUSPENDED" },
      });
    }

    // 3. Create AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_SERVICE_SUSPENDED",
        entityType: "ServiceSuspension",
        entityId: suspension.id,
        metadata: {
          customerId,
          startDate: parsedStart.toISOString().slice(0, 10),
          endDate: parsedEnd.toISOString().slice(0, 10),
          reason: cleanReason,
        },
      },
    });

    return suspension;
  });

  return result;
}

/**
 * Lists all service suspensions for a customer.
 */
export async function listSuspensions(customerId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  const customer = await prisma.customerProfile.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
  }

  const suspensions = await prisma.serviceSuspension.findMany({
    where: { customerId },
    orderBy: { startDate: "desc" },
  });

  return suspensions;
}

/**
 * Unsuspends a customer early. Truncates suspension so it affects future dates only.
 * Past attendance already marked ABSENT remains unchanged.
 */
export async function unsuspendCustomer(customerId, suspensionId, actorId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }
  if (!suspensionId || typeof suspensionId !== "string") {
    throw ApiError.badRequest("Invalid suspension ID.");
  }

  const suspension = await prisma.serviceSuspension.findFirst({
    where: {
      id: suspensionId,
      customerId,
    },
  });

  if (!suspension) {
    throw ApiError.notFound(`Service suspension with ID '${suspensionId}' not found.`);
  }

  const todayDate = getBusinessDate();

  if (new Date(suspension.endDate).getTime() < todayDate.getTime()) {
    throw ApiError.badRequest("Cannot unsuspend: Suspension has already expired.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const prevEndDate = suspension.endDate;
    let updatedOrDeleted = null;

    if (new Date(suspension.startDate).getTime() >= todayDate.getTime()) {
      // Future suspension or starting today: delete it so today and future dates are free
      await tx.serviceSuspension.delete({
        where: { id: suspensionId },
      });
      updatedOrDeleted = { action: "DELETED", id: suspensionId };
    } else {
      // Started in the past and extends into future: truncate endDate to yesterday
      const yesterdayMs = todayDate.getTime() - 24 * 60 * 60 * 1000;
      const yesterdayDate = getBusinessDate(new Date(yesterdayMs));
      const updated = await tx.serviceSuspension.update({
        where: { id: suspensionId },
        data: { endDate: yesterdayDate },
      });
      updatedOrDeleted = { action: "TRUNCATED", suspension: updated };
    }

    // Check if any other suspension remains active for today
    const remainingSuspension = await tx.serviceSuspension.findFirst({
      where: {
        id: { not: suspensionId },
        customerId,
        startDate: { lte: todayDate },
        endDate: { gte: todayDate },
      },
    });

    if (!remainingSuspension) {
      const cust = await tx.customerProfile.findUnique({
        where: { id: customerId },
      });
      const newStatus = cust.remainingTiffins > 0 ? "ACTIVE" : "PAYMENT_SUSPENDED";
      await tx.customerProfile.update({
        where: { id: customerId },
        data: { serviceStatus: newStatus },
      });
    }

    // Create AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_SERVICE_UNSUSPENDED",
        entityType: "ServiceSuspension",
        entityId: suspensionId,
        metadata: {
          customerId,
          suspensionId,
          previousEndDate: prevEndDate,
          actionTaken: updatedOrDeleted.action,
        },
      },
    });

    return updatedOrDeleted;
  });

  return {
    message: "Customer service unsuspended successfully.",
    result,
  };
}
