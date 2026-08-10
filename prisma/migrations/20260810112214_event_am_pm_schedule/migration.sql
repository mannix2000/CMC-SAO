-- Revert the per-student AM/PM time tracking added in the previous migration; attendance timing
-- moves to a per-event reference schedule instead (set once by admin, not tracked per student).
ALTER TABLE "attendance_checks" DROP COLUMN "timeInAm";
ALTER TABLE "attendance_checks" DROP COLUMN "timeOutAm";
ALTER TABLE "attendance_checks" DROP COLUMN "timeInPm";
ALTER TABLE "attendance_checks" DROP COLUMN "timeOutPm";
ALTER TABLE "attendance_checks" ALTER COLUMN "status" SET NOT NULL;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "morningStart" TIME,
ADD COLUMN "morningCutoff" TIME,
ADD COLUMN "afternoonStart" TIME,
ADD COLUMN "afternoonCutoff" TIME;
