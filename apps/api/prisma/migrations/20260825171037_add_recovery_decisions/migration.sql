-- CreateEnum
CREATE TYPE "DecisionPriority" AS ENUM ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendedAction" AS ENUM ('RETRY', 'WAIT', 'CUSTOMER_ACTION_REQUIRED', 'DO_NOT_RETRY', 'REVIEW', 'NO_ACTION');

-- CreateTable
CREATE TABLE "recovery_decisions" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "opportunityId" UUID NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "priority" "DecisionPriority" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "recommendedAction" "RecommendedAction" NOT NULL,
    "reasons" JSONB NOT NULL,
    "factors" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_decisions_merchantId_idx" ON "recovery_decisions"("merchantId");

-- CreateIndex
CREATE INDEX "recovery_decisions_priority_idx" ON "recovery_decisions"("priority");

-- CreateIndex
CREATE INDEX "recovery_decisions_recommendedAction_idx" ON "recovery_decisions"("recommendedAction");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_decisions_opportunityId_engineVersion_key" ON "recovery_decisions"("opportunityId", "engineVersion");

-- AddForeignKey
ALTER TABLE "recovery_decisions" ADD CONSTRAINT "recovery_decisions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_decisions" ADD CONSTRAINT "recovery_decisions_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "recovery_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
