-- CreateEnum
CREATE TYPE "SimulationRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "merchant_strategy_memory" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "simulation_runs" (
    "id" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "merchantCount" INTEGER NOT NULL DEFAULT 10,
    "eventsPerMerchant" INTEGER NOT NULL DEFAULT 100,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "status" "SimulationRunStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processingDurationMs" INTEGER,
    "processedEvents" INTEGER NOT NULL DEFAULT 0,
    "successfulPayments" INTEGER NOT NULL DEFAULT 0,
    "failedPayments" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesDetected" INTEGER NOT NULL DEFAULT 0,
    "executionsAttempted" INTEGER NOT NULL DEFAULT 0,
    "executionsBlocked" INTEGER NOT NULL DEFAULT 0,
    "humanReviews" INTEGER NOT NULL DEFAULT 0,
    "recoveriesVerified" INTEGER NOT NULL DEFAULT 0,
    "revenueAtRisk" INTEGER NOT NULL DEFAULT 0,
    "recoverableRevenue" INTEGER NOT NULL DEFAULT 0,
    "recoveredRevenue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulation_runs_status_idx" ON "simulation_runs"("status");

-- CreateIndex
CREATE INDEX "simulation_runs_createdAt_idx" ON "simulation_runs"("createdAt" DESC);
