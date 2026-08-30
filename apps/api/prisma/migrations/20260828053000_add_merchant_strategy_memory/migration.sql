-- CreateEnum
CREATE TYPE "MerchantMemoryStrategy" AS ENUM ('RETRY', 'PAYMENT_LINK', 'ALTERNATE_METHOD', 'REVIEW', 'WAIT', 'CUSTOMER_ACTION_REQUIRED', 'DO_NOT_RETRY', 'NO_ACTION');

-- CreateTable
CREATE TABLE "merchant_strategy_memory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchantId" UUID NOT NULL,
    "strategy" "MerchantMemoryStrategy" NOT NULL,
    "failureType" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "humanReviews" INTEGER NOT NULL DEFAULT 0,
    "totalAmountAttempted" INTEGER NOT NULL DEFAULT 0,
    "totalAmountRecovered" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "effectivenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_strategy_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_strategy_memory_merchantId_strategy_failureType_key" ON "merchant_strategy_memory"("merchantId", "strategy", "failureType");

-- CreateIndex
CREATE INDEX "merchant_strategy_memory_merchantId_idx" ON "merchant_strategy_memory"("merchantId");

-- CreateIndex
CREATE INDEX "merchant_strategy_memory_effectivenessScore_idx" ON "merchant_strategy_memory"("effectivenessScore" DESC);

-- AddForeignKey
ALTER TABLE "merchant_strategy_memory" ADD CONSTRAINT "merchant_strategy_memory_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
