const prisma = require('../config/db');
const { syncFineForCheck } = require('./fines');

const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];

/**
 * Marks (creates or updates) one officer's attendance check for a student at an
 * event, then syncs any resulting fine. Shared by the web officer routes and the
 * mobile JSON API so both stay in lockstep.
 */
async function markStudentAttendance({ eventId, studentId, officerRole, status, checkedById }) {
  if (!VALID_STATUSES.includes(status)) {
    return { error: 'invalid_status', message: 'Invalid status' };
  }

  const [event, student] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.student.findUnique({ where: { id: studentId } }),
  ]);
  if (!event || !student) {
    return { error: 'not_found', message: 'Event or student not found' };
  }

  const check = await prisma.attendanceCheck.upsert({
    where: { eventId_studentId_officerRole: { eventId, studentId, officerRole } },
    create: { eventId, studentId, officerRole, status, checkedById },
    update: { status, checkedById },
  });

  await syncFineForCheck(check);

  return { check };
}

module.exports = { markStudentAttendance, VALID_STATUSES };
