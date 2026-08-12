-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "actionCardBrand" TEXT,
ADD COLUMN     "actionCardLast4" TEXT,
ADD COLUMN     "actionToken" TEXT;
