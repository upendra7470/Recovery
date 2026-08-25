-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('pending', 'processed', 'duplicate', 'unsupported', 'failed');

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "paymentAccountId" UUID,
    "merchantId" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "eventCreatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "normalizedData" JSONB,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'pending',
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_events_paymentAccountId_idx" ON "payment_events"("paymentAccountId");

-- CreateIndex
CREATE INDEX "payment_events_merchantId_idx" ON "payment_events"("merchantId");

-- CreateIndex
CREATE INDEX "payment_events_providerPaymentId_idx" ON "payment_events"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payment_events_processingStatus_idx" ON "payment_events"("processingStatus");

-- CreateIndex
CREATE INDEX "payment_events_receivedAt_idx" ON "payment_events"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key" ON "payment_events"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
