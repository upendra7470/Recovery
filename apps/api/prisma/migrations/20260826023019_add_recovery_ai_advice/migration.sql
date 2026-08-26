-- CreateEnum
CREATE TYPE "AIAdviceStatus" AS ENUM ('AVAILABLE');

-- CreateTable
CREATE TABLE "recovery_ai_advice" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "opportunityId" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "advisorVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AIAdviceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "summary" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "nextStep" TEXT NOT NULL,
    "customerMessage" TEXT,
    "operatorMessage" TEXT,
    "confidence" INTEGER NOT NULL,
    "warnings" JSONB NOT NULL,
    "safetyConstrained" BOOLEAN NOT NULL DEFAULT false,
    "decisionFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_ai_advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_ai_advice_merchantId_idx" ON "recovery_ai_advice"("merchantId");

-- CreateIndex
CREATE INDEX "recovery_ai_advice_opportunityId_idx" ON "recovery_ai_advice"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_ai_advice_decisionId_advisorVersion_model_key" ON "recovery_ai_advice"("decisionId", "advisorVersion", "model");

-- AddForeignKey
ALTER TABLE "recovery_ai_advice" ADD CONSTRAINT "recovery_ai_advice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_ai_advice" ADD CONSTRAINT "recovery_ai_advice_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "recovery_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_ai_advice" ADD CONSTRAINT "recovery_ai_advice_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "recovery_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
