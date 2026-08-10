const { toCsv } = require('./csv');
const { formatClockTime } = require('./timeOfDay');

/**
 * Builds an attendance report CSV for an event.
 * students: Student[]
 * checksByStudentId: Map<studentId, { ssg?: AttendanceCheck, nstp?: AttendanceCheck }>
 * event: Event (with requiresSsg/requiresNstp)
 *
 * SSG and NSTP are kept in their own columns (never merged) so it's always
 * clear which officer role recorded which status/time.
 */
function buildAttendanceReportCsv(event, students, checksByStudentId) {
  const columns = [
    { label: 'Student Number', value: (s) => s.studentNumber },
    { label: 'Last Name', value: (s) => s.lastName },
    { label: 'First Name', value: (s) => s.firstName },
    { label: 'Course', value: (s) => s.course },
    { label: 'Year Level', value: (s) => s.yearLevel },
    { label: 'Section', value: (s) => s.section },
  ];

  if (event.requiresSsg) {
    columns.push(
      { label: 'SSG Status', value: (s) => checksByStudentId.get(s.id)?.ssg?.status || 'unmarked' },
      { label: 'SSG Morning Time In', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.ssg?.timeInAm) || '' },
      { label: 'SSG Morning Time Out', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.ssg?.timeOutAm) || '' },
      { label: 'SSG Afternoon Time In', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.ssg?.timeInPm) || '' },
      { label: 'SSG Afternoon Time Out', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.ssg?.timeOutPm) || '' }
    );
  }

  if (event.requiresNstp) {
    columns.push(
      { label: 'NSTP Status', value: (s) => checksByStudentId.get(s.id)?.nstp?.status || 'unmarked' },
      { label: 'NSTP Morning Time In', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.nstp?.timeInAm) || '' },
      { label: 'NSTP Morning Time Out', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.nstp?.timeOutAm) || '' },
      { label: 'NSTP Afternoon Time In', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.nstp?.timeInPm) || '' },
      { label: 'NSTP Afternoon Time Out', value: (s) => formatClockTime(checksByStudentId.get(s.id)?.nstp?.timeOutPm) || '' }
    );
  }

  columns.push({ label: 'Overall', value: (s) => computeOverallStatus(event, checksByStudentId.get(s.id)) });
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
