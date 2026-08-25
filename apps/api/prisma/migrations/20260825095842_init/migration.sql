-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('razorpay');

-- CreateEnum
CREATE TYPE "PaymentAccountEnvironment" AS ENUM ('test', 'production');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" "PaymentAccountEnvironment" NOT NULL,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'active',
    "displayName" TEXT,
    "externalAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_accounts_merchantId_idx" ON "payment_accounts"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_provider_environment_externalAccountId_key" ON "payment_accounts"("provider", "environment", "externalAccountId");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
