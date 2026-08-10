const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { getSummary, listEntries, buildBudgetCsv } = require('../services/budget');
const { getFilterOptions, buildStudentWhere } = require('../services/students');
const { listFines, getFineSummary, markPaid, markUnpaid, buildFinesCsv } = require('../services/fines');
const { markStudentAttendance, markAttendanceTime, finalizeAttendanceForRoster } = require('../services/attendanceMarking');
const { getFilterOptions: getFacultyFilterOptions, buildFacultyWhere } = require('../services/faculty');
const { formatTimeOfDay, formatClockTime } = require('../services/timeOfDay');

const router = express.Router();
router.use(requireRole('ssg', 'nstp'));

router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('officer/events_list', { title: 'Events', events });
});

router.get('/events/:id/attendance', async (req, res) => {
  const eventId = Number(req.params.id);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });

  const officerRole = req.session.user.role;
  const q = (req.query.q || '').trim();
  const course = (req.query.course || '').trim();
  const yearLevel = (req.query.yearLevel || '').trim();
  const section = (req.query.section || '').trim();

  const [students, filterOptions] = await Promise.all([
    prisma.student.findMany({
      where: buildStudentWhere({ q, course, yearLevel, section }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    getFilterOptions(),
  ]);

  const requiresThisOrg = officerRole === 'ssg' ? event.requiresSsg : event.requiresNstp;
  if (requiresThisOrg) {
    await finalizeAttendanceForRoster({
      event,
      officerRole,
      checkedById: req.session.user.id,
      studentIds: students.map((s) => s.id),
    });
  }

  const checks = await prisma.attendanceCheck.findMany({ where: { eventId, officerRole } });
  const checkByStudentId = new Map(checks.map((c) => [c.studentId, c]));

  res.render('officer/attendance', {
    title: `Attendance: ${event.name}`,
    event,
    students,
    checkByStudentId,
    q,
    course,
    yearLevel,
    section,
    filterOptions,
    officerRole,
    formatTimeOfDay,
    formatClockTime,
  });
});

// Present/Late/Absent are derived automatically from recorded times; the only manual
// override an officer can make here is Excused (or clearing it back to automatic).
router.post('/events/:id/attendance/:studentId', async (req, res) => {
  const status = req.body.status === 'excused' ? 'excused' : req.body.status === null ? null : undefined;
  if (status === undefined) return res.status(400).json({ error: 'Only excused (or clearing it) can be set manually' });

  const result = await markStudentAttendance({
    eventId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    officerRole: req.session.user.role,
    status,
    checkedById: req.session.user.id,
  });
  if (result.error === 'invalid_status') return res.status(400).json({ error: result.message });
  if (result.error === 'not_found') return res.status(404).json({ error: result.message });
  res.json({ ok: true, status: result.check.status });
});

router.post('/events/:id/attendance/:studentId/time', async (req, res) => {
  const result = await markAttendanceTime({
    eventId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    officerRole: req.session.user.role,
    session: req.body.session,
    type: req.body.type,
    checkedById: req.session.user.id,
  });
  if (result.error === 'invalid_time_slot') return res.status(400).json({ error: result.message });
  if (result.error === 'not_found') return res.status(404).json({ error: result.message });
  const { check } = result;
  res.json({
    ok: true,
    status: check.status,
    timeInAm: check.timeInAm,
    timeOutAm: check.timeOutAm,
    timeInPm: check.timeInPm,
    timeOutPm: check.timeOutPm,
  });
});

// ---------- Faculty & Staff Attendance (NSTP only) ----------

router.get('/events/:id/faculty-attendance', requireRole('nstp'), async (req, res) => {
  const eventId = Number(req.params.id);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });

  const q = (req.query.q || '').trim();
  const department = (req.query.department || '').trim();

  const [facultyList, filterOptions, checks] = await Promise.all([
    prisma.facultyStaff.findMany({
      where: buildFacultyWhere({ q, department }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    getFacultyFilterOptions(),
    prisma.facultyAttendanceCheck.findMany({ where: { eventId } }),
  ]);
  const statusByFacultyId = new Map(checks.map((c) => [c.facultyStaffId, c.status]));

  res.render('officer/faculty_attendance', {
    title: `Faculty & Staff Attendance: ${event.name}`,
    event,
    facultyList,
    statusByFacultyId,
    q,
    department,
    filterOptions,
  });
});

router.post('/events/:id/faculty-attendance/:facultyId', requireRole('nstp'), async (req, res) => {
  const eventId = Number(req.params.id);
  const facultyStaffId = Number(req.params.facultyId);
  const { status } = req.body;

  const validStatuses = ['present', 'absent', 'late', 'excused'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const [event, faculty] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.facultyStaff.findUnique({ where: { id: facultyStaffId } }),
  ]);
  if (!event || !faculty) return res.status(404).json({ error: 'Not found' });

  const check = await prisma.facultyAttendanceCheck.upsert({
    where: { eventId_facultyStaffId: { eventId, facultyStaffId } },
    create: { eventId, facultyStaffId, status, checkedById: req.session.user.id },
    update: { status, checkedById: req.session.user.id },
  });

  res.json({ ok: true, status: check.status });
});

// ---------- Budget & Expenses ----------

const budgetValidators = [
  body('type').isIn(['income', 'expense']).withMessage('Invalid type'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('entryDate').isISO8601().withMessage('Valid date is required'),
];

router.get('/budget', async (req, res) => {
  const orgRole = req.session.user.role;
  const [summary, entries] = await Promise.all([getSummary(orgRole), listEntries({ orgRole })]);
  res.render('officer/budget_list', { title: 'Budget & Expenses', summary, entries, orgRole });
});

router.get('/budget/export', async (req, res) => {
  const orgRole = req.session.user.role;
  const entries = await listEntries({ orgRole });
  const csv = buildBudgetCsv(entries);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="budget_${orgRole}.csv"`);
  res.send(csv);
});

router.get('/budget/new', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('officer/budget_form', { title: 'New Budget Entry', entry: null, events, errors: [] });
});

router.post('/budget', budgetValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('officer/budget_form', { title: 'New Budget Entry', entry: req.body, events, errors: errors.array() });
  }
  const { type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.create({
    data: {
      orgRole: req.session.user.role,
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
      recordedById: req.session.user.id,
    },
  });
  res.redirect('/officer/budget');
});

router.get('/budget/:id/edit', async (req, res) => {
  const entry = await prisma.budgetEntry.findUnique({ where: { id: Number(req.params.id) } });
  if (!entry || entry.orgRole !== req.session.user.role) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Budget entry not found.' });
  }
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('officer/budget_form', { title: 'Edit Budget Entry', entry, events, errors: [] });
});

router.post('/budget/:id', budgetValidators, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.budgetEntry.findUnique({ where: { id } });
  if (!existing || existing.orgRole !== req.session.user.role) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Budget entry not found.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('officer/budget_form', { title: 'Edit Budget Entry', entry: { id, ...req.body }, events, errors: errors.array() });
  }

  const { type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.update({
    where: { id },
    data: {
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
    },
  });
  res.redirect('/officer/budget');
});

router.post('/budget/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.budgetEntry.findUnique({ where: { id } });
  if (existing && existing.orgRole === req.session.user.role) {
    await prisma.budgetEntry.delete({ where: { id } });
  }
  res.redirect('/officer/budget');
});

// ---------- Fines ----------

router.get('/fines', async (req, res) => {
  const orgRole = req.session.user.role;
  const status = ['paid', 'unpaid'].includes(req.query.status) ? req.query.status : null;
  const [summary, fines] = await Promise.all([getFineSummary(orgRole), listFines({ orgRole, status })]);
  res.render('officer/fines_list', { title: 'Fines', summary, fines, status, orgRole });
});

router.get('/fines/export', async (req, res) => {
  const orgRole = req.session.user.role;
  const fines = await listFines({ orgRole });
  const csv = buildFinesCsv(fines);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="fines_${orgRole}.csv"`);
  res.send(csv);
});

router.post('/fines/:id/pay', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.fine.findUnique({ where: { id } });
  if (existing && existing.orgRole === req.session.user.role) {
    await markPaid(id, req.session.user.id);
  }
  res.redirect('/officer/fines');
});

router.post('/fines/:id/unpay', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.fine.findUnique({ where: { id } });
  if (existing && existing.orgRole === req.session.user.role) {
    await markUnpaid(id);
  }
  res.redirect('/officer/fines');
});

module.exports = router;
