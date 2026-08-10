-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ssg', 'nstp');

-- CreateEnum
CREATE TYPE "BudgetEntryType" AS ENUM ('income', 'expense');

-- CreateTable
CREATE TABLE "budget_entries" (
    "id" SERIAL NOT NULL,
    "orgRole" "OrgRole" NOT NULL,
    "type" "BudgetEntryType" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "eventId" INTEGER,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_entries_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
