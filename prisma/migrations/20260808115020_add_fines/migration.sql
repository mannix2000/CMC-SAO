-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('unpaid', 'paid');

-- AlterTable
ALTER TABLE "settings"
  ADD COLUMN "absentFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lateFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fines" (
    "id" SERIAL NOT NULL,
    "attendanceCheckId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "orgRole" "OrgRole" NOT NULL,
    "reason" "AttendanceStatus" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "FineStatus" NOT NULL DEFAULT 'unpaid',
    "paidAt" TIMESTAMP(3),
    "paidById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fines_attendanceCheckId_key" ON "fines"("attendanceCheckId");

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_attendanceCheckId_fkey" FOREIGN KEY ("attendanceCheckId") REFERENCES "attendance_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
