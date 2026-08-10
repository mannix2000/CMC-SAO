const { toCsv } = require('./csv');

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
