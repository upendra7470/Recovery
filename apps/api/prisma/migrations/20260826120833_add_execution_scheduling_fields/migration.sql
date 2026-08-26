-- CreateEnum
CREATE TYPE "ExecutionOrigin" AS ENUM ('MANUAL', 'AUTOMATED');

-- DropIndex
DROP INDEX "recovery_executions_status_idx";

-- AlterTable
ALTER TABLE "recovery_executions" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "origin" "ExecutionOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "recovery_executions_status_nextAttemptAt_idx" ON "recovery_executions"("status", "nextAttemptAt");
