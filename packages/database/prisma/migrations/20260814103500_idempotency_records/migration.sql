-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "lockToken" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_merchantId_key_key" ON "IdempotencyRecord"("merchantId", "key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_merchantId_createdAt_idx" ON "IdempotencyRecord"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_lockedUntil_idx" ON "IdempotencyRecord"("lockedUntil");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
