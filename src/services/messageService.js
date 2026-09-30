import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";
import { getNow } from "../utils/businessTime.js";

/**
 * Creates a new message from the authenticated customer to the owner.
 */
export async function createCustomerMessage(userId, { message }) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    throw ApiError.badRequest("Message content cannot be empty.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  const cleanMessage = message.trim();
  if (cleanMessage.length > 2000) {
    throw ApiError.badRequest("Message length exceeds maximum allowed limit (2000 characters).");
  }

  const newMessage = await prisma.message.create({
    data: {
      customerId: profile.id,
      message: cleanMessage,
      status: "UNREAD",
    },
  });

  return newMessage;
}

/**
 * Lists messages for the authenticated customer only.
 */
export async function listCustomerMessages(userId) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  const messages = await prisma.message.findMany({
    where: { customerId: profile.id },
    orderBy: { createdAt: "desc" },
  });

  return messages;
}

/**
 * Lists messages for the OWNER with optional filtering and pagination.
 */
export async function listOwnerMessages({ status, customerId, page = 1, limit = 20 } = {}) {
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {};
  if (status && ["UNREAD", "READ", "RESOLVED"].includes(status)) {
    where.status = status;
  }
  if (customerId && typeof customerId === "string" && customerId.trim()) {
    where.customerId = customerId.trim();
  }

  const [total, messages] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      skip,
      take: parsedLimit,
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            user: {
              select: {
                id: true,
                loginIdentifier: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    messages,
    pagination: {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    },
  };
}

/**
 * Updates a message status by the OWNER (marking as READ or RESOLVED).
 */
export async function updateMessageStatusByOwner(messageId, { status }, actorId) {
  if (!messageId || typeof messageId !== "string") {
    throw ApiError.badRequest("Invalid message ID.");
  }

  if (!status || !["READ", "RESOLVED"].includes(status)) {
    throw ApiError.badRequest("Status must be either 'READ' or 'RESOLVED'.");
  }

  const existing = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!existing) {
    throw ApiError.notFound(`Message with ID '${messageId}' not found.`);
  }

  if (existing.status === "RESOLVED") {
    throw ApiError.badRequest("Cannot modify message: This message is already resolved.");
  }

  const now = getNow();
  const updateData = { status };

  if (status === "READ") {
    updateData.readAt = existing.readAt || now;
  } else if (status === "RESOLVED") {
    updateData.readAt = existing.readAt || now;
    updateData.resolvedAt = now;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.update({
      where: { id: messageId },
      data: updateData,
    });

    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_UPDATED_MESSAGE",
        entityType: "Message",
        entityId: messageId,
        metadata: {
          messageId,
          previousStatus: existing.status,
          newStatus: status,
        },
      },
    });

    return msg;
  });

  return updated;
}

export { listCustomerMessages as listMessagesForCustomer };
export { listOwnerMessages as listMessagesForOwner };

