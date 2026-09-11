CREATE TABLE "SellerBlock" (
  "accountId" TEXT NOT NULL,
  "label" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SellerBlock_pkey" PRIMARY KEY ("accountId")
);
