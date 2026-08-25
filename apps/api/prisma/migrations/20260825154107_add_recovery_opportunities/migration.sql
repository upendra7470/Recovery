-- CreateEnum
CREATE TYPE "RecoveryOpportunityType" AS ENUM ('FAILED_PAYMENT', 'SUBSCRIPTION_PAYMENT_FAILED', 'CHECKOUT_DROPOFF');

-- CreateEnum
CREATE TYPE "RecoveryOpportunityStatus" AS ENUM ('OPEN', 'RECOVERED', 'EXPIRED', 'DISMISSED');

-- CreateTable
CREATE TABLE "recovery_opportunities" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "paymentAccountId" UUID,
    "type" "RecoveryOpportunityType" NOT NULL,
    "status" "RecoveryOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "sourceEventId" UUID NOT NULL,
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "amountAtRisk" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recoveryEventId" UUID,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_opportunities_merchantId_idx" ON "recovery_opportunities"("merchantId");

-- CreateIndex
CREATE INDEX "recovery_opportunities_status_idx" ON "recovery_opportunities"("status");

-- CreateIndex
CREATE INDEX "recovery_opportunities_type_idx" ON "recovery_opportunities"("type");

-- CreateIndex
CREATE INDEX "recovery_opportunities_detectedAt_idx" ON "recovery_opportunities"("detectedAt");

-- CreateIndex
CREATE INDEX "recovery_opportunities_providerPaymentId_idx" ON "recovery_opportunities"("providerPaymentId");

-- CreateIndex
CREATE INDEX "recovery_opportunities_providerOrderId_idx" ON "recovery_opportunities"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_opportunities_sourceEventId_type_key" ON "recovery_opportunities"("sourceEventId", "type");

-- AddForeignKey
ALTER TABLE "recovery_opportunities" ADD CONSTRAINT "recovery_opportunities_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_opportunities" ADD CONSTRAINT "recovery_opportunities_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_opportunities" ADD CONSTRAINT "recovery_opportunities_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "payment_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_opportunities" ADD CONSTRAINT "recovery_opportunities_recoveryEventId_fkey" FOREIGN KEY ("recoveryEventId") REFERENCES "payment_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
