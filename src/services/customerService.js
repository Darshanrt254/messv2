import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import ApiError from "../utils/apiError.js";

/**
 * Strips sensitive data and formats safe customer profile representation.
 */
export function formatSafeCustomer(profile) {
  if (!profile) return null;

  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    phone: profile.phone,
    profilePictureUrl: profile.profilePictureUrl || null,
    remainingTiffins: profile.remainingTiffins,
    serviceStatus: profile.serviceStatus,
    isPaymentSuspended: profile.remainingTiffins <= 0,
    joinDate: profile.joinDate,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    user: profile.user
      ? {
          id: profile.user.id,
          loginIdentifier: profile.user.loginIdentifier,
          role: profile.user.role,
        }
      : undefined,
  };
}

/**
 * Retrieves authenticated customer's own profile by their User ID.
 */
export async function getCustomerProfileByUserId(userId) {
  if (!userId) {
    throw ApiError.unauthorized("Authentication required.");
  }

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
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

  if (!profile) {
    throw ApiError.notFound("Customer profile not found.");
  }

  return {
    userId: profile.userId,
    loginIdentifier: profile.user.loginIdentifier,
    customerProfileId: profile.id,
    name: profile.name,
    phone: profile.phone,
    profilePictureUrl: profile.profilePictureUrl,
    remainingTiffins: profile.remainingTiffins,
    serviceStatus: profile.serviceStatus,
    isPaymentSuspended: profile.remainingTiffins <= 0,
    joinDate: profile.joinDate,
    createdAt: profile.createdAt,
  };
}

/**
 * Retrieves paginated list of all customers for OWNER dashboard.
 */
export async function listCustomers({ page = 1, limit = 20, search = "" } = {}) {
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {};
  if (search && typeof search === "string" && search.trim()) {
    const term = search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { phone: { contains: term, mode: "insensitive" } },
      { user: { loginIdentifier: { contains: term, mode: "insensitive" } } },
    ];
  }

  const [total, profiles] = await Promise.all([
    prisma.customerProfile.count({ where }),
    prisma.customerProfile.findMany({
      where,
      skip,
      take: parsedLimit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            loginIdentifier: true,
            role: true,
          },
        },
      },
    }),
  ]);

  return {
    customers: profiles.map(formatSafeCustomer),
    pagination: {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    },
  };
}

/**
 * Retrieves single customer detail by CustomerProfile ID for OWNER.
 */
export async function getCustomerById(customerId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  const profile = await prisma.customerProfile.findUnique({
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

  if (!profile) {
    throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
  }

  return formatSafeCustomer(profile);
}

/**
 * Creates a customer account transactionally:
 * 1. User
 * 2. CustomerProfile
 * 3. INITIAL_BALANCE TiffinTransaction
 * 4. AuditLog
 */
export async function createCustomer({
  name,
  phone,
  loginIdentifier,
  password,
  profilePictureUrl = null,
  initialTiffins = 56,
  actorId,
}) {
  // Input validations
  if (!name || typeof name !== "string" || !name.trim()) {
    throw ApiError.badRequest("Customer name is required.");
  }
  if (!phone || typeof phone !== "string" || !phone.trim()) {
    throw ApiError.badRequest("Phone number is required.");
  }
  if (!loginIdentifier || typeof loginIdentifier !== "string" || !loginIdentifier.trim()) {
    throw ApiError.badRequest("Login identifier is required.");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw ApiError.badRequest("Password is required and must be at least 6 characters long.");
  }

  // Validate initial tiffin balance
  const parsedInitialTiffins =
    initialTiffins !== undefined && initialTiffins !== null
      ? Number(initialTiffins)
      : 56;

  if (!Number.isInteger(parsedInitialTiffins) || parsedInitialTiffins < 0) {
    throw ApiError.badRequest("Initial tiffin balance must be a non-negative integer.");
  }

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const normalizedIdentifier = loginIdentifier.trim().toLowerCase();
  const cleanProfilePic = profilePictureUrl && typeof profilePictureUrl === "string" ? profilePictureUrl.trim() : null;

  // Uniqueness / Conflict pre-checks
  const existingUser = await prisma.user.findUnique({
    where: { loginIdentifier: normalizedIdentifier },
  });
  if (existingUser) {
    throw ApiError.conflict("A user with this login identifier already exists.");
  }

  const existingPhone = await prisma.customerProfile.findUnique({
    where: { phone: trimmedPhone },
  });
  if (existingPhone) {
    throw ApiError.conflict("A customer with this phone number already exists.");
  }

  // Securely hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Execute atomic transactional creation
  const created = await prisma.$transaction(async (tx) => {
    // 1. Create User
    const user = await tx.user.create({
      data: {
        role: "CUSTOMER",
        loginIdentifier: normalizedIdentifier,
        passwordHash,
      },
    });

    // 2. Create CustomerProfile
    const customerProfile = await tx.customerProfile.create({
      data: {
        userId: user.id,
        name: trimmedName,
        phone: trimmedPhone,
        profilePictureUrl: cleanProfilePic,
        remainingTiffins: parsedInitialTiffins,
        serviceStatus: "ACTIVE",
      },
    });

    // 3. Create INITIAL_BALANCE TiffinTransaction
    const transaction = await tx.tiffinTransaction.create({
      data: {
        customerId: customerProfile.id,
        quantity: parsedInitialTiffins,
        type: "INITIAL_BALANCE",
        reason: `Initial tiffin package allocation (${parsedInitialTiffins} tiffins)`,
        createdBy: actorId || null,
      },
    });

    // 4. Create AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_CREATED_CUSTOMER",
        entityType: "CustomerProfile",
        entityId: customerProfile.id,
        metadata: {
          customerName: trimmedName,
          phone: trimmedPhone,
          loginIdentifier: normalizedIdentifier,
          initialTiffins: parsedInitialTiffins,
          transactionId: transaction.id,
        },
      },
    });

    return {
      ...customerProfile,
      user: {
        id: user.id,
        loginIdentifier: user.loginIdentifier,
        role: user.role,
      },
    };
  });

  return formatSafeCustomer(created);
}

/**
 * Updates basic customer profile information (name, phone, profilePictureUrl).
 * Disallows direct modification of remainingTiffins, passwordHash, role, userId, serviceStatus.
 */
export async function updateCustomer(customerId, updatePayload, actorId) {
  if (!customerId || typeof customerId !== "string") {
    throw ApiError.badRequest("Invalid customer ID.");
  }

  const existingProfile = await prisma.customerProfile.findUnique({
    where: { id: customerId },
  });

  if (!existingProfile) {
    throw ApiError.notFound(`Customer with ID '${customerId}' not found.`);
  }

  const dataToUpdate = {};
  const previousValues = {};

  // Disallow restricted fields
  const forbiddenFields = [
    "remainingTiffins",
    "password",
    "passwordHash",
    "role",
    "userId",
    "id",
    "serviceStatus",
    "createdAt",
  ];
  for (const field of forbiddenFields) {
    if (updatePayload[field] !== undefined) {
      delete updatePayload[field];
    }
  }

  if (updatePayload.name !== undefined) {
    if (typeof updatePayload.name !== "string" || !updatePayload.name.trim()) {
      throw ApiError.badRequest("Customer name cannot be empty.");
    }
    const cleanName = updatePayload.name.trim();
    if (cleanName !== existingProfile.name) {
      previousValues.name = existingProfile.name;
      dataToUpdate.name = cleanName;
    }
  }

  if (updatePayload.phone !== undefined) {
    if (typeof updatePayload.phone !== "string" || !updatePayload.phone.trim()) {
      throw ApiError.badRequest("Phone number cannot be empty.");
    }
    const cleanPhone = updatePayload.phone.trim();
    if (cleanPhone !== existingProfile.phone) {
      // Check duplicate phone with other customers
      const conflictPhone = await prisma.customerProfile.findUnique({
        where: { phone: cleanPhone },
      });
      if (conflictPhone && conflictPhone.id !== customerId) {
        throw ApiError.conflict("Phone number is already in use by another customer.");
      }
      previousValues.phone = existingProfile.phone;
      dataToUpdate.phone = cleanPhone;
    }
  }

  if (updatePayload.profilePictureUrl !== undefined) {
    const cleanPic =
      updatePayload.profilePictureUrl && typeof updatePayload.profilePictureUrl === "string"
        ? updatePayload.profilePictureUrl.trim()
        : null;
    if (cleanPic !== existingProfile.profilePictureUrl) {
      previousValues.profilePictureUrl = existingProfile.profilePictureUrl;
      dataToUpdate.profilePictureUrl = cleanPic;
    }
  }

  // If no changes, return current profile directly
  if (Object.keys(dataToUpdate).length === 0) {
    return getCustomerById(customerId);
  }

  // Perform update and audit log inside transaction
  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.customerProfile.update({
      where: { id: customerId },
      data: dataToUpdate,
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

    await tx.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "OWNER_UPDATED_CUSTOMER",
        entityType: "CustomerProfile",
        entityId: customerId,
        metadata: {
          updatedFields: Object.keys(dataToUpdate),
          previousValues,
          newValues: dataToUpdate,
        },
      },
    });

    return profile;
  });

  return formatSafeCustomer(updated);
}
