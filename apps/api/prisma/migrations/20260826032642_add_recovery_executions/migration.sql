-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "recovery_executions" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "opportunityId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "action" "RecommendedAction" NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerPaymentId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_executions_idempotencyKey_key" ON "recovery_executions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "recovery_executions_opportunityId_idx" ON "recovery_executions"("opportunityId");

-- CreateIndex
CREATE INDEX "recovery_executions_merchantId_idx" ON "recovery_executions"("merchantId");

-- CreateIndex
CREATE INDEX "recovery_executions_decisionId_idx" ON "recovery_executions"("decisionId");

-- CreateIndex
CREATE INDEX "recovery_executions_status_idx" ON "recovery_executions"("status");

-- CreateIndex
CREATE INDEX "recovery_executions_createdAt_idx" ON "recovery_executions"("createdAt");

-- AddForeignKey
ALTER TABLE "recovery_executions" ADD CONSTRAINT "recovery_executions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_executions" ADD CONSTRAINT "recovery_executions_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "recovery_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_executions" ADD CONSTRAINT "recovery_executions_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "recovery_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
