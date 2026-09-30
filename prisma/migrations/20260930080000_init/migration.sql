-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'SERVICE_SUSPENDED', 'PAYMENT_SUSPENDED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('UNMARKED', 'PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "MealLocation" AS ENUM ('COLLEGE', 'RESTAURANT');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('CUSTOMER', 'OWNER', 'AUTO', 'SUSPENSION', 'WEEKLY_RULE');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TiffinTransactionType" AS ENUM ('INITIAL_BALANCE', 'CASH_RECHARGE', 'MEAL_TOKEN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('UNREAD', 'READ', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "loginIdentifier" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "profilePictureUrl" TEXT,
    "remainingTiffins" INTEGER NOT NULL DEFAULT 56,
    "serviceStatus" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'UNMARKED',
    "location" "MealLocation",
    "source" "AttendanceSource" NOT NULL DEFAULT 'CUSTOMER',
    "markedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL DEFAULT 'LUNCH',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "option" "MealLocation" NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_tokens" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "location" "MealLocation" NOT NULL,
    "serialNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_counters" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "location" "MealLocation" NOT NULL,
    "nextSerial" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiffin_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" "TiffinTransactionType" NOT NULL,
    "reason" TEXT,
    "attendanceId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiffin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_suspensions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_loginIdentifier_key" ON "users"("loginIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_userId_key" ON "customer_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_phone_key" ON "customer_profiles"("phone");

-- CreateIndex
CREATE INDEX "attendances_customerId_date_idx" ON "attendances"("customerId", "date");

-- CreateIndex
CREATE INDEX "attendances_date_mealType_idx" ON "attendances"("date", "mealType");

-- CreateIndex
CREATE INDEX "attendances_date_mealType_location_idx" ON "attendances"("date", "mealType", "location");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_customerId_date_mealType_key" ON "attendances"("customerId", "date", "mealType");

-- CreateIndex
CREATE INDEX "polls_date_mealType_idx" ON "polls"("date", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "polls_date_mealType_key" ON "polls"("date", "mealType");

-- CreateIndex
CREATE INDEX "poll_votes_customerId_idx" ON "poll_votes"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_pollId_customerId_key" ON "poll_votes"("pollId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_tokens_attendanceId_key" ON "meal_tokens"("attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_tokens_token_key" ON "meal_tokens"("token");

-- CreateIndex
CREATE INDEX "meal_tokens_date_mealType_location_idx" ON "meal_tokens"("date", "mealType", "location");

-- CreateIndex
CREATE UNIQUE INDEX "meal_counters_date_mealType_location_key" ON "meal_counters"("date", "mealType", "location");

-- CreateIndex
CREATE INDEX "tiffin_transactions_customerId_createdAt_idx" ON "tiffin_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "tiffin_transactions_customerId_type_idx" ON "tiffin_transactions"("customerId", "type");

-- CreateIndex
CREATE INDEX "tiffin_transactions_attendanceId_idx" ON "tiffin_transactions"("attendanceId");

-- CreateIndex
CREATE INDEX "service_suspensions_customerId_startDate_endDate_idx" ON "service_suspensions"("customerId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "messages_customerId_createdAt_idx" ON "messages"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_tokens" ADD CONSTRAINT "meal_tokens_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiffin_transactions" ADD CONSTRAINT "tiffin_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiffin_transactions" ADD CONSTRAINT "tiffin_transactions_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiffin_transactions" ADD CONSTRAINT "tiffin_transactions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_suspensions" ADD CONSTRAINT "service_suspensions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_suspensions" ADD CONSTRAINT "service_suspensions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
