-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "systemName" TEXT NOT NULL DEFAULT 'CMC SAO',
    "logoPath" TEXT,
    "backgroundImagePath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);
