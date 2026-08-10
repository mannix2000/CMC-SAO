const prisma = require('../config/db');
const { syncFineForCheck } = require('./fines');

const VALID_STATUSES = ['present', 'absent', 'late', 'excused'];
const VALID_SESSIONS = ['am', 'pm'];
const VALID_TIME_TYPES = ['in', 'out'];

const TIME_FIELD_BY_SESSION_TYPE = {
  am_in: 'timeInAm',
  am_out: 'timeOutAm',
  pm_in: 'timeInPm',
  pm_out: 'timeOutPm',
};

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

/**
 * Records the current time as a student's morning/afternoon time-in or time-out for
 * an event, independent of (and possibly before) the officer choosing a status.
 */
async function markAttendanceTime({ eventId, studentId, officerRole, session, type, checkedById }) {
  if (!VALID_SESSIONS.includes(session) || !VALID_TIME_TYPES.includes(type)) {
    return { error: 'invalid_time_slot', message: 'Invalid session or type' };
  }

  const [event, student] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.student.findUnique({ where: { id: studentId } }),
  ]);
  if (!event || !student) {
    return { error: 'not_found', message: 'Event or student not found' };
  }

  const field = TIME_FIELD_BY_SESSION_TYPE[`${session}_${type}`];
  const now = new Date();

  const check = await prisma.attendanceCheck.upsert({
    where: { eventId_studentId_officerRole: { eventId, studentId, officerRole } },
    create: { eventId, studentId, officerRole, checkedById, [field]: now },
    update: { checkedById, [field]: now },
  });

  return { check };
}

module.exports = { markStudentAttendance, markAttendanceTime, VALID_STATUSES, VALID_SESSIONS, VALID_TIME_TYPES };
