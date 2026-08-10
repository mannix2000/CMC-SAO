-- Allow status to stay unset while an officer records arrival/departure times before choosing a status
ALTER TABLE "attendance_checks" ALTER COLUMN "status" DROP NOT NULL;

-- AlterTable
ALTER TABLE "attendance_checks" ADD COLUMN "timeInAm" TIMESTAMP(3),
ADD COLUMN "timeOutAm" TIMESTAMP(3),
ADD COLUMN "timeInPm" TIMESTAMP(3),
ADD COLUMN "timeOutPm" TIMESTAMP(3);
