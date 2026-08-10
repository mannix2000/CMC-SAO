const prisma = require('../config/db');
const { syncFineForCheck } = require('./fines');
const { computeAutoStatus } = require('./attendanceStatus');

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
 * mobile JSON API so both stay in lockstep. A `status` of null clears a manual
 * override (e.g. un-excusing a student) so the time-based auto status takes back over.
 */
async function markStudentAttendance({ eventId, studentId, officerRole, status, checkedById }) {
  if (status !== null && !VALID_STATUSES.includes(status)) {
    return { error: 'invalid_status', message: 'Invalid status' };
  }

  const [event, student] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.student.findUnique({ where: { id: studentId } }),
  ]);
  if (!event || !student) {
    return { error: 'not_found', message: 'Event or student not found' };
  }

  let check = await prisma.attendanceCheck.upsert({
    where: { eventId_studentId_officerRole: { eventId, studentId, officerRole } },
    create: { eventId, studentId, officerRole, status, checkedById },
    update: { status, checkedById },
  });

  if (status === null) {
    const autoStatus = computeAutoStatus(event, check);
    if (autoStatus !== check.status) {
      check = await prisma.attendanceCheck.update({ where: { id: check.id }, data: { status: autoStatus } });
    }
  }

  await syncFineForCheck(check);

  return { check };
}

/**
 * Records the current time as a student's morning/afternoon time-in or time-out for
 * an event, then re-derives the attendance status (present/late) from that time
 * against the event's cutoff schedule - unless the status was manually excused,
 * which is a protected override that a time entry should never silently overwrite.
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

  let check = await prisma.attendanceCheck.upsert({
    where: { eventId_studentId_officerRole: { eventId, studentId, officerRole } },
    create: { eventId, studentId, officerRole, checkedById, [field]: now },
    update: { checkedById, [field]: now },
  });

  if (check.status !== 'excused') {
    const autoStatus = computeAutoStatus(event, check, now);
    if (autoStatus !== check.status) {
      check = await prisma.attendanceCheck.update({ where: { id: check.id }, data: { status: autoStatus } });
    }
  }

  await syncFineForCheck(check);

  return { check };
}

/**
 * Lazily "closes out" attendance for a roster: any student who never checked in for
 * a session whose cutoff has already lapsed is auto-marked absent (and fined), and
 * any student left in limbo from a since-passed cutoff gets their status refreshed.
 * Manually-excused students are left untouched. Meant to be called whenever an
 * event's attendance is viewed, so absences resolve automatically without an officer
 * having to click anything.
 */
async function finalizeAttendanceForRoster({ event, officerRole, checkedById, studentIds }) {
  if (studentIds.length === 0) return;

  const now = new Date();
  const existingChecks = await prisma.attendanceCheck.findMany({
    where: { eventId: event.id, officerRole, studentId: { in: studentIds } },
  });
  const checkByStudentId = new Map(existingChecks.map((c) => [c.studentId, c]));

  await Promise.all(
    studentIds.map(async (studentId) => {
      const existing = checkByStudentId.get(studentId);
      if (existing?.status === 'excused') return;

      const autoStatus = computeAutoStatus(event, existing, now);
      if (autoStatus === null) return;
      if (existing && existing.status === autoStatus) return;

      const check = existing
        ? await prisma.attendanceCheck.update({ where: { id: existing.id }, data: { status: autoStatus } })
        : await prisma.attendanceCheck.create({
            data: { eventId: event.id, studentId, officerRole, status: autoStatus, checkedById },
          });

      await syncFineForCheck(check);
    })
  );
}

module.exports = {
  markStudentAttendance,
  markAttendanceTime,
  finalizeAttendanceForRoster,
  VALID_STATUSES,
  VALID_SESSIONS,
  VALID_TIME_TYPES,
};
