const { toCsv } = require('./csv');
const { formatClockTime } = require('./timeOfDay');

/**
 * Picks a time field (timeInAm/timeOutAm/timeInPm/timeOutPm) off whichever officer
 * check recorded it first, since either SSG or NSTP may have logged the time.
 */
function pickCheckTime(checks, field) {
  return checks?.ssg?.[field] || checks?.nstp?.[field] || null;
}

/**
 * Builds an attendance report CSV for an event.
 * students: Student[]
 * checksByStudentId: Map<studentId, { ssg?: AttendanceCheck, nstp?: AttendanceCheck }>
 * event: Event (with requiresSsg/requiresNstp)
 */
function buildAttendanceReportCsv(event, students, checksByStudentId) {
  const columns = [
    { label: 'Student Number', value: (s) => s.studentNumber },
    { label: 'Last Name', value: (s) => s.lastName },
    { label: 'First Name', value: (s) => s.firstName },
    { label: 'Course', value: (s) => s.course },
    { label: 'Year Level', value: (s) => s.yearLevel },
    { label: 'Section', value: (s) => s.section },
    { label: 'SSG Status', value: (s) => checksByStudentId.get(s.id)?.ssg?.status || 'unmarked' },
    { label: 'NSTP Status', value: (s) => checksByStudentId.get(s.id)?.nstp?.status || 'unmarked' },
    { label: 'Morning Time In', value: (s) => formatClockTime(pickCheckTime(checksByStudentId.get(s.id), 'timeInAm')) || '' },
    { label: 'Morning Time Out', value: (s) => formatClockTime(pickCheckTime(checksByStudentId.get(s.id), 'timeOutAm')) || '' },
    { label: 'Afternoon Time In', value: (s) => formatClockTime(pickCheckTime(checksByStudentId.get(s.id), 'timeInPm')) || '' },
    { label: 'Afternoon Time Out', value: (s) => formatClockTime(pickCheckTime(checksByStudentId.get(s.id), 'timeOutPm')) || '' },
    { label: 'Overall', value: (s) => computeOverallStatus(event, checksByStudentId.get(s.id)) },
  ];
  return toCsv(students, columns);
}

function computeOverallStatus(event, checks) {
  const required = [];
  if (event.requiresSsg) required.push(checks?.ssg?.status);
  if (event.requiresNstp) required.push(checks?.nstp?.status);
  if (required.length === 0) return 'n/a';
  if (required.some((s) => !s)) return 'incomplete';
  if (required.every((s) => s === 'present')) return 'present';
  return 'absent';
}

module.exports = { buildAttendanceReportCsv, computeOverallStatus };
