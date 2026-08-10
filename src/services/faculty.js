const prisma = require('../config/db');
const { toCsv } = require('./csv');

async function getFilterOptions() {
  const departments = await prisma.facultyStaff.findMany({
    distinct: ['department'],
    select: { department: true },
    orderBy: { department: 'asc' },
  });
  return { departments: departments.map((d) => d.department) };
}

function buildFacultyWhere({ q, department }) {
  const and = [];
  if (q) {
    and.push({
      OR: [
        { lastName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (department) and.push({ department });
  return and.length ? { AND: and } : {};
}

function buildFacultyReportCsv(facultyList, checksByFacultyId) {
  const columns = [
    { label: 'Last Name', value: (f) => f.lastName },
    { label: 'First Name', value: (f) => f.firstName },
    { label: 'Department', value: (f) => f.department },
    { label: 'Status', value: (f) => checksByFacultyId.get(f.id)?.status || 'unmarked' },
  ];
  return toCsv(facultyList, columns);
}

module.exports = { getFilterOptions, buildFacultyWhere, buildFacultyReportCsv };
