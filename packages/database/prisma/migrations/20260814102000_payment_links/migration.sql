-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "merchantReferencePrefix" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "paymentLinkId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_publicToken_key" ON "PaymentLink"("publicToken");

-- CreateIndex
CREATE INDEX "PaymentLink_merchantId_createdAt_idx" ON "PaymentLink"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentLink_merchantId_active_idx" ON "PaymentLink"("merchantId", "active");

-- CreateIndex
CREATE INDEX "PaymentIntent_paymentLinkId_idx" ON "PaymentIntent"("paymentLinkId");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
