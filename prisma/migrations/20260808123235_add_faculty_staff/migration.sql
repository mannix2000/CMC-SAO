-- CreateTable
CREATE TABLE "faculty_staff" (
    "id" SERIAL NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "department" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_attendance_checks" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "facultyStaffId" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "checkedById" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_attendance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculty_attendance_checks_eventId_facultyStaffId_key" ON "faculty_attendance_checks"("eventId", "facultyStaffId");

-- AddForeignKey
ALTER TABLE "faculty_attendance_checks" ADD CONSTRAINT "faculty_attendance_checks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_attendance_checks" ADD CONSTRAINT "faculty_attendance_checks_facultyStaffId_fkey" FOREIGN KEY ("facultyStaffId") REFERENCES "faculty_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_attendance_checks" ADD CONSTRAINT "faculty_attendance_checks_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
