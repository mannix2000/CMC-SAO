const prisma = require('../config/db');

async function getFilterOptions() {
  const [courses, yearLevels, sections] = await Promise.all([
    prisma.student.findMany({ distinct: ['course'], select: { course: true }, orderBy: { course: 'asc' } }),
    prisma.student.findMany({ distinct: ['yearLevel'], select: { yearLevel: true }, orderBy: { yearLevel: 'asc' } }),
    prisma.student.findMany({ distinct: ['section'], select: { section: true }, orderBy: { section: 'asc' } }),
  ]);
  return {
    courses: courses.map((c) => c.course),
    yearLevels: yearLevels.map((y) => y.yearLevel),
    sections: sections.map((s) => s.section),
  };
}

function buildStudentWhere({ q, course, yearLevel, section }) {
  const and = [];
  if (q) {
    and.push({
      OR: [
        { studentNumber: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { course: { contains: q, mode: 'insensitive' } },
        { section: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (course) and.push({ course });
  if (yearLevel) and.push({ yearLevel });
  if (section) and.push({ section });
  return and.length ? { AND: and } : {};
}

module.exports = { getFilterOptions, buildStudentWhere };
