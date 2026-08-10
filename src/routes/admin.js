const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireRole } = require('../middleware/auth');
const { parseRosterFile, parsePastedRows, REQUIRED_COLUMNS, OPTIONAL_COLUMNS } = require('../services/rosterImport');
const { buildAttendanceReportCsv, computeOverallStatus } = require('../services/reportExport');
const { updateSettings } = require('../services/settings');
const { getSummaries, getOrganizationSummary, listEntries, buildBudgetCsv } = require('../services/budget');
const { getFilterOptions, buildStudentWhere } = require('../services/students');
const { listFines, getFineSummary, markPaid, markUnpaid, buildFinesCsv } = require('../services/fines');
const { finalizeAttendanceForRoster } = require('../services/attendanceMarking');
const { listOrganizations, getOrganization, syncMembers, listMemberStudentIds } = require('../services/organizations');
const {
  getFilterOptions: getFacultyFilterOptions,
  buildFacultyWhere,
  buildFacultyReportCsv,
} = require('../services/faculty');
const { buildTimeOptions, timeOfDayToValue, parseTimeOfDay, formatTimeOfDay, formatClockTime } = require('../services/timeOfDay');

const router = express.Router();
router.use(requireRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.(csv|xlsx)$/i.test(file.originalname);
    if (!okExt) return cb(new Error('Only .csv and .xlsx files are allowed.'));
    cb(null, true);
  },
});

const BRANDING_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'branding');
fs.mkdirSync(BRANDING_DIR, { recursive: true });

function clearExisting(prefix) {
  for (const f of fs.readdirSync(BRANDING_DIR)) {
    if (f.startsWith(prefix)) fs.unlinkSync(path.join(BRANDING_DIR, f));
  }
}

const brandingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, BRANDING_DIR),
    filename: (req, file, cb) => {
      const prefix = file.fieldname === 'logo' ? 'logo' : 'background';
      clearExisting(prefix);
      cb(null, `${prefix}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    if (!okType) return cb(new Error('Only PNG, JPEG, WEBP, or GIF images are allowed.'));
    cb(null, true);
  },
});

router.get('/', async (req, res) => {
  const [studentCount, eventCount, officerCount] = await Promise.all([
    prisma.student.count(),
    prisma.event.count(),
    prisma.user.count({ where: { role: { in: ['ssg', 'nstp'] } } }),
  ]);
  res.render('admin/dashboard', { title: 'Admin Dashboard', studentCount, eventCount, officerCount });
});

// ---------- Students ----------

router.get('/students', async (req, res) => {
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

  res.render('admin/students_list', { title: 'Students', students, q, course, yearLevel, section, filterOptions });
});

router.get('/students/template', (req, res) => {
  const header = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(',');
  const sample = '2021-00001,Dela Cruz,Juan,Santos,BS Computer Science,3,BSCS-3A,juan.delacruz@example.com';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student_roster_template.csv"');
  res.send(`${header}\n${sample}\n`);
});

router.get('/students/new', (req, res) => {
  res.render('admin/student_form', { title: 'Add Student', student: null, errors: [] });
});

router.post(
  '/students',
  [
    body('studentNumber').trim().notEmpty().withMessage('Student number is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('course').trim().notEmpty().withMessage('Course is required'),
    body('yearLevel').trim().notEmpty().withMessage('Year level is required'),
    body('section').trim().notEmpty().withMessage('Section is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/student_form', {
        title: 'Add Student',
        student: req.body,
        errors: errors.array(),
      });
    }
    const { studentNumber, lastName, firstName, middleName, course, yearLevel, section, email } = req.body;
    try {
      await prisma.student.create({
        data: { studentNumber, lastName, firstName, middleName: middleName || null, course, yearLevel, section, email: email || null },
      });
      res.redirect('/admin/students');
    } catch (err) {
      const msg = err.code === 'P2002' ? 'A student with that student number already exists.' : 'Could not save student.';
      res.status(400).render('admin/student_form', { title: 'Add Student', student: req.body, errors: [{ msg }] });
    }
  }
);

router.get('/students/import', (req, res) => {
  res.render('admin/students_import', { title: 'Import Roster', preview: null, parseErrors: [] });
});

router.post('/students/import', upload.single('rosterFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).render('admin/students_import', { title: 'Import Roster', preview: null, parseErrors: ['No file uploaded.'] });
  }
  try {
    const { validRows, errors } = await parseRosterFile(req.file);
    req.session.pendingImport = { rows: validRows, uploadedAt: Date.now() };
    res.render('admin/students_import', {
      title: 'Import Roster',
      preview: { rows: validRows.slice(0, 50), total: validRows.length },
      parseErrors: errors,
    });
  } catch (err) {
    res.status(400).render('admin/students_import', { title: 'Import Roster', preview: null, parseErrors: [`Could not parse file: ${err.message}`] });
  }
});

router.post('/students/import/confirm', async (req, res) => {
  const pending = req.session.pendingImport;
  if (!pending || !pending.rows || pending.rows.length === 0) {
    return res.status(400).render('admin/students_import', { title: 'Import Roster', preview: null, parseErrors: ['No pending import to confirm. Please upload again.'] });
  }

  const existingNumbers = new Set(
    (await prisma.student.findMany({ where: { studentNumber: { in: pending.rows.map((r) => r.studentNumber) } }, select: { studentNumber: true } })).map(
      (s) => s.studentNumber
    )
  );

  let created = 0;
  let updated = 0;
  const failures = [];

  for (const row of pending.rows) {
    try {
      await prisma.student.upsert({
        where: { studentNumber: row.studentNumber },
        create: row,
        update: row,
      });
      if (existingNumbers.has(row.studentNumber)) updated += 1;
      else created += 1;
    } catch (err) {
      failures.push(`${row.studentNumber}: ${err.message}`);
    }
  }

  delete req.session.pendingImport;
  res.render('admin/students_import_result', { title: 'Import Complete', created, updated, failures });
});

router.get('/students/paste', (req, res) => {
  res.render('admin/students_paste', { title: 'Paste Students', preview: null, parseErrors: [], form: {} });
});

router.post('/students/paste', (req, res) => {
  const { course, yearLevel, section, pasteData } = req.body;
  if (!course || !yearLevel || !section) {
    return res.status(400).render('admin/students_paste', {
      title: 'Paste Students',
      preview: null,
      parseErrors: ['Program, Year Level, and Section are required.'],
      form: req.body,
    });
  }
  const { validRows, errors } = parsePastedRows(pasteData, {
    course: course.trim(),
    yearLevel: yearLevel.trim(),
    section: section.trim(),
  });
  req.session.pendingImport = { rows: validRows, uploadedAt: Date.now() };
  res.render('admin/students_import', {
    title: 'Paste Students',
    preview: { rows: validRows.slice(0, 50), total: validRows.length },
    parseErrors: errors,
  });
});

router.get('/students/:id/edit', async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: Number(req.params.id) } });
  if (!student) return res.status(404).render('error', { title: 'Not Found', message: 'Student not found.' });
  res.render('admin/student_form', { title: 'Edit Student', student, errors: [] });
});

router.post(
  '/students/:id',
  [
    body('studentNumber').trim().notEmpty().withMessage('Student number is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('course').trim().notEmpty().withMessage('Course is required'),
    body('yearLevel').trim().notEmpty().withMessage('Year level is required'),
    body('section').trim().notEmpty().withMessage('Section is required'),
  ],
  async (req, res) => {
    const id = Number(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/student_form', {
        title: 'Edit Student',
        student: { id, ...req.body },
        errors: errors.array(),
      });
    }
    const { studentNumber, lastName, firstName, middleName, course, yearLevel, section, email } = req.body;
    try {
      await prisma.student.update({
        where: { id },
        data: { studentNumber, lastName, firstName, middleName: middleName || null, course, yearLevel, section, email: email || null },
      });
      res.redirect('/admin/students');
    } catch (err) {
      const msg = err.code === 'P2002' ? 'A student with that student number already exists.' : 'Could not save student.';
      res.status(400).render('admin/student_form', { title: 'Edit Student', student: { id, ...req.body }, errors: [{ msg }] });
    }
  }
);

router.post('/students/:id/delete', async (req, res) => {
  await prisma.student.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.redirect('/admin/students');
});

// ---------- Faculty & Staff ----------

router.get('/faculty', async (req, res) => {
  const q = (req.query.q || '').trim();
  const department = (req.query.department || '').trim();

  const [facultyList, filterOptions] = await Promise.all([
    prisma.facultyStaff.findMany({
      where: buildFacultyWhere({ q, department }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    getFacultyFilterOptions(),
  ]);

  res.render('admin/faculty_list', { title: 'Faculty & Staff', facultyList, q, department, filterOptions });
});

router.get('/faculty/new', (req, res) => {
  res.render('admin/faculty_form', { title: 'Add Faculty/Staff', faculty: null, errors: [] });
});

router.post(
  '/faculty',
  [
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('department').trim().notEmpty().withMessage('Department is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/faculty_form', { title: 'Add Faculty/Staff', faculty: req.body, errors: errors.array() });
    }
    const { lastName, firstName, middleName, department, position, email } = req.body;
    await prisma.facultyStaff.create({
      data: { lastName, firstName, middleName: middleName || null, department, position: position || null, email: email || null },
    });
    res.redirect('/admin/faculty');
  }
);

router.get('/faculty/:id/edit', async (req, res) => {
  const faculty = await prisma.facultyStaff.findUnique({ where: { id: Number(req.params.id) } });
  if (!faculty) return res.status(404).render('error', { title: 'Not Found', message: 'Faculty/staff member not found.' });
  res.render('admin/faculty_form', { title: 'Edit Faculty/Staff', faculty, errors: [] });
});

router.post(
  '/faculty/:id',
  [
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('department').trim().notEmpty().withMessage('Department is required'),
  ],
  async (req, res) => {
    const id = Number(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/faculty_form', { title: 'Edit Faculty/Staff', faculty: { id, ...req.body }, errors: errors.array() });
    }
    const { lastName, firstName, middleName, department, position, email } = req.body;
    await prisma.facultyStaff.update({
      where: { id },
      data: { lastName, firstName, middleName: middleName || null, department, position: position || null, email: email || null },
    });
    res.redirect('/admin/faculty');
  }
);

router.post('/faculty/:id/delete', async (req, res) => {
  await prisma.facultyStaff.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.redirect('/admin/faculty');
});

// ---------- Organizations ----------

router.get('/organizations', async (req, res) => {
  const organizations = await listOrganizations();
  res.render('admin/organizations_list', { title: 'Organizations', organizations });
});

router.get('/organizations/new', (req, res) => {
  res.render('admin/organization_form', { title: 'New Organization', organization: null, errors: [] });
});

router.post(
  '/organizations',
  [body('name').trim().notEmpty().withMessage('Name is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/organization_form', { title: 'New Organization', organization: req.body, errors: errors.array() });
    }
    const { name, description } = req.body;
    try {
      await prisma.organization.create({
        data: { name, description: description || null, createdById: req.session.user.id },
      });
      res.redirect('/admin/organizations');
    } catch (err) {
      const msg = err.code === 'P2002' ? 'An organization with that name already exists.' : 'Could not save organization.';
      res.status(400).render('admin/organization_form', { title: 'New Organization', organization: req.body, errors: [{ msg }] });
    }
  }
);

router.get('/organizations/:id/edit', async (req, res) => {
  const organization = await getOrganization(Number(req.params.id));
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });
  res.render('admin/organization_form', { title: 'Edit Organization', organization, errors: [] });
});

router.post(
  '/organizations/:id',
  [body('name').trim().notEmpty().withMessage('Name is required')],
  async (req, res) => {
    const id = Number(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/organization_form', { title: 'Edit Organization', organization: { id, ...req.body }, errors: errors.array() });
    }
    const { name, description } = req.body;
    try {
      await prisma.organization.update({ where: { id }, data: { name, description: description || null } });
      res.redirect('/admin/organizations');
    } catch (err) {
      const msg = err.code === 'P2002' ? 'An organization with that name already exists.' : 'Could not save organization.';
      res.status(400).render('admin/organization_form', { title: 'Edit Organization', organization: { id, ...req.body }, errors: [{ msg }] });
    }
  }
);

router.post('/organizations/:id/delete', async (req, res) => {
  await prisma.organization.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.redirect('/admin/organizations');
});

router.get('/organizations/:id/members', async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });

  const q = (req.query.q || '').trim();
  const course = (req.query.course || '').trim();
  const yearLevel = (req.query.yearLevel || '').trim();
  const section = (req.query.section || '').trim();

  const [students, filterOptions, memberIds] = await Promise.all([
    prisma.student.findMany({
      where: buildStudentWhere({ q, course, yearLevel, section }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    getFilterOptions(),
    listMemberStudentIds(organizationId),
  ]);

  res.render('admin/organization_members', {
    title: `Members: ${organization.name}`,
    organization,
    students,
    memberIds,
    q,
    course,
    yearLevel,
    section,
    filterOptions,
  });
});

router.post('/organizations/:id/members', async (req, res) => {
  const organizationId = Number(req.params.id);
  const candidateIds = String(req.body.candidateIds || '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  const checkedIds = [].concat(req.body.memberIds || []).map(Number);

  await syncMembers(organizationId, candidateIds, checkedIds);
  res.redirect(`/admin/organizations/${organizationId}/members`);
});

// ---------- Organization Budget & Expenses ----------

const orgBudgetValidators = [
  body('type').isIn(['income', 'expense']).withMessage('Invalid type'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('entryDate').isISO8601().withMessage('Valid date is required'),
];

router.get('/organizations/:id/budget', async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });

  const [summary, entries] = await Promise.all([
    getOrganizationSummary(organizationId),
    listEntries({ organizationId }),
  ]);
  res.render('admin/organization_budget_list', { title: `Budget: ${organization.name}`, organization, summary, entries });
});

router.get('/organizations/:id/budget/export', async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });
  const entries = await listEntries({ organizationId });
  const csv = buildBudgetCsv(entries);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="budget_org_${organizationId}.csv"`);
  res.send(csv);
});

router.get('/organizations/:id/budget/new', async (req, res) => {
  const organization = await getOrganization(Number(req.params.id));
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('admin/organization_budget_form', { title: 'New Budget Entry', organization, entry: null, events, errors: [] });
});

router.post('/organizations/:id/budget', orgBudgetValidators, async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('admin/organization_budget_form', { title: 'New Budget Entry', organization, entry: req.body, events, errors: errors.array() });
  }
  const { type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.create({
    data: {
      organizationId,
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
      recordedById: req.session.user.id,
    },
  });
  res.redirect(`/admin/organizations/${organizationId}/budget`);
});

router.get('/organizations/:id/budget/:entryId/edit', async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });
  const entry = await prisma.budgetEntry.findUnique({ where: { id: Number(req.params.entryId) } });
  if (!entry || entry.organizationId !== organizationId) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Budget entry not found.' });
  }
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('admin/organization_budget_form', { title: 'Edit Budget Entry', organization, entry, events, errors: [] });
});

router.post('/organizations/:id/budget/:entryId', orgBudgetValidators, async (req, res) => {
  const organizationId = Number(req.params.id);
  const organization = await getOrganization(organizationId);
  if (!organization) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });

  const entryId = Number(req.params.entryId);
  const existing = await prisma.budgetEntry.findUnique({ where: { id: entryId } });
  if (!existing || existing.organizationId !== organizationId) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Budget entry not found.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('admin/organization_budget_form', { title: 'Edit Budget Entry', organization, entry: { id: entryId, ...req.body }, events, errors: errors.array() });
  }

  const { type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.update({
    where: { id: entryId },
    data: {
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
    },
  });
  res.redirect(`/admin/organizations/${organizationId}/budget`);
});

router.post('/organizations/:id/budget/:entryId/delete', async (req, res) => {
  const organizationId = Number(req.params.id);
  const entryId = Number(req.params.entryId);
  const existing = await prisma.budgetEntry.findUnique({ where: { id: entryId } });
  if (existing && existing.organizationId === organizationId) {
    await prisma.budgetEntry.delete({ where: { id: entryId } });
  }
  res.redirect(`/admin/organizations/${organizationId}/budget`);
});

// ---------- Events ----------

router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('admin/events_list', { title: 'Events', events, formatTimeOfDay });
});

router.get('/events/new', (req, res) => {
  res.render('admin/event_form', {
    title: 'New Event',
    event: null,
    errors: [],
    timeOptions: buildTimeOptions(),
    morningStartValue: '',
    morningCutoffValue: '',
    afternoonStartValue: '',
    afternoonCutoffValue: '',
  });
});

router.post(
  '/events',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').isIn(['flag_ceremony', 'assembly', 'other']).withMessage('Invalid type'),
    body('eventDate').isISO8601().withMessage('Valid date is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const { morningStart = '', morningCutoff = '', afternoonStart = '', afternoonCutoff = '' } = req.body;
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/event_form', {
        title: 'New Event',
        event: req.body,
        errors: errors.array(),
        timeOptions: buildTimeOptions(),
        morningStartValue: morningStart,
        morningCutoffValue: morningCutoff,
        afternoonStartValue: afternoonStart,
        afternoonCutoffValue: afternoonCutoff,
      });
    }
    const { name, type, eventDate } = req.body;
    const requiresSsg = req.body.requiresSsg === 'on';
    const requiresNstp = req.body.requiresNstp === 'on';
    await prisma.event.create({
      data: {
        name,
        type,
        eventDate: new Date(eventDate),
        requiresSsg,
        requiresNstp,
        morningStart: parseTimeOfDay(morningStart),
        morningCutoff: parseTimeOfDay(morningCutoff),
        afternoonStart: parseTimeOfDay(afternoonStart),
        afternoonCutoff: parseTimeOfDay(afternoonCutoff),
        createdById: req.session.user.id,
      },
    });
    res.redirect('/admin/events');
  }
);

router.get('/events/:id/edit', async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: Number(req.params.id) } });
  if (!event) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });
  res.render('admin/event_form', {
    title: 'Edit Event',
    event,
    errors: [],
    timeOptions: buildTimeOptions(),
    morningStartValue: timeOfDayToValue(event.morningStart),
    morningCutoffValue: timeOfDayToValue(event.morningCutoff),
    afternoonStartValue: timeOfDayToValue(event.afternoonStart),
    afternoonCutoffValue: timeOfDayToValue(event.afternoonCutoff),
  });
});

router.post(
  '/events/:id',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').isIn(['flag_ceremony', 'assembly', 'other']).withMessage('Invalid type'),
    body('eventDate').isISO8601().withMessage('Valid date is required'),
  ],
  async (req, res) => {
    const id = Number(req.params.id);
    const errors = validationResult(req);
    const { morningStart = '', morningCutoff = '', afternoonStart = '', afternoonCutoff = '' } = req.body;
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/event_form', {
        title: 'Edit Event',
        event: { id, ...req.body },
        errors: errors.array(),
        timeOptions: buildTimeOptions(),
        morningStartValue: morningStart,
        morningCutoffValue: morningCutoff,
        afternoonStartValue: afternoonStart,
        afternoonCutoffValue: afternoonCutoff,
      });
    }
    const { name, type, eventDate } = req.body;
    const requiresSsg = req.body.requiresSsg === 'on';
    const requiresNstp = req.body.requiresNstp === 'on';
    await prisma.event.update({
      where: { id },
      data: {
        name,
        type,
        eventDate: new Date(eventDate),
        requiresSsg,
        requiresNstp,
        morningStart: parseTimeOfDay(morningStart),
        morningCutoff: parseTimeOfDay(morningCutoff),
        afternoonStart: parseTimeOfDay(afternoonStart),
        afternoonCutoff: parseTimeOfDay(afternoonCutoff),
      },
    });
    res.redirect('/admin/events');
  }
);

router.post('/events/:id/delete', async (req, res) => {
  await prisma.event.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.redirect('/admin/events');
});

async function loadReportData(eventId, checkedById) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;
  const students = await prisma.student.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });

  const studentIds = students.map((s) => s.id);
  await Promise.all([
    event.requiresSsg
      ? finalizeAttendanceForRoster({ event, officerRole: 'ssg', checkedById, studentIds })
      : null,
    event.requiresNstp
      ? finalizeAttendanceForRoster({ event, officerRole: 'nstp', checkedById, studentIds })
      : null,
  ]);

  const checks = await prisma.attendanceCheck.findMany({ where: { eventId } });
  const checksByStudentId = new Map();
  for (const c of checks) {
    const entry = checksByStudentId.get(c.studentId) || {};
    entry[c.officerRole] = c;
    checksByStudentId.set(c.studentId, entry);
  }

  const facultyList = await prisma.facultyStaff.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const facultyChecks = await prisma.facultyAttendanceCheck.findMany({ where: { eventId } });
  const facultyChecksById = new Map(facultyChecks.map((c) => [c.facultyStaffId, c]));

  return { event, students, checksByStudentId, facultyList, facultyChecksById };
}

router.get('/events/:id/report', async (req, res) => {
  const data = await loadReportData(Number(req.params.id), req.session.user.id);
  if (!data) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });
  res.render('admin/event_report', { title: `Report: ${data.event.name}`, ...data, computeOverallStatus, formatClockTime });
});

router.get('/events/:id/report/export', async (req, res) => {
  const data = await loadReportData(Number(req.params.id), req.session.user.id);
  if (!data) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });
  const csv = buildAttendanceReportCsv(data.event, data.students, data.checksByStudentId);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${data.event.id}.csv"`);
  res.send(csv);
});

router.get('/events/:id/report/faculty-export', async (req, res) => {
  const data = await loadReportData(Number(req.params.id));
  if (!data) return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.' });
  const csv = buildFacultyReportCsv(data.facultyList, data.facultyChecksById);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="faculty_attendance_${data.event.id}.csv"`);
  res.send(csv);
});

// ---------- Officer accounts ----------

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.render('admin/users_list', { title: 'Officer Accounts', users, currentUserId: req.session.user.id });
});

router.get('/users/new', (req, res) => {
  res.render('admin/user_form', { title: 'New Officer Account', errors: [] });
});

router.post(
  '/users',
  [
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('role').isIn(['admin', 'ssg', 'nstp']).withMessage('Invalid role'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/user_form', { title: 'New Officer Account', errors: errors.array() });
    }
    const { username, email, role, password } = req.body;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: { username, email: email || null, role, passwordHash, createdById: req.session.user.id },
      });
      res.redirect('/admin/users');
    } catch (err) {
      const msg = err.code === 'P2002' ? 'That username or email is already taken.' : 'Could not create account.';
      res.status(400).render('admin/user_form', { title: 'New Officer Account', errors: [{ msg }] });
    }
  }
);

router.post('/users/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) {
    return res.redirect('/admin/users');
  }
  await prisma.user.delete({ where: { id } }).catch(() => {});
  res.redirect('/admin/users');
});

router.post(
  '/users/:id/reset-password',
  [body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect('/admin/users');
    }
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await prisma.user.update({ where: { id: Number(req.params.id) }, data: { passwordHash } }).catch(() => {});
    res.redirect('/admin/users');
  }
);

// ---------- Budget & Expenses ----------

const budgetValidators = [
  body('orgRole').isIn(['ssg', 'nstp']).withMessage('Invalid organization'),
  body('type').isIn(['income', 'expense']).withMessage('Invalid type'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('entryDate').isISO8601().withMessage('Valid date is required'),
];

router.get('/budget', async (req, res) => {
  const org = ['ssg', 'nstp'].includes(req.query.org) ? req.query.org : null;
  const [summaries, entries] = await Promise.all([getSummaries(), listEntries({ orgRole: org })]);
  res.render('admin/budget_list', { title: 'Budget & Expenses', summaries, entries, org });
});

router.get('/budget/export', async (req, res) => {
  const org = ['ssg', 'nstp'].includes(req.query.org) ? req.query.org : null;
  const entries = await listEntries({ orgRole: org });
  const csv = buildBudgetCsv(entries);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="budget_${org || 'all'}.csv"`);
  res.send(csv);
});

router.get('/budget/new', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('admin/budget_form', { title: 'New Budget Entry', entry: null, events, errors: [] });
});

router.post('/budget', budgetValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('admin/budget_form', { title: 'New Budget Entry', entry: req.body, events, errors: errors.array() });
  }
  const { orgRole, type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.create({
    data: {
      orgRole,
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
      recordedById: req.session.user.id,
    },
  });
  res.redirect('/admin/budget');
});

router.get('/budget/:id/edit', async (req, res) => {
  const entry = await prisma.budgetEntry.findUnique({ where: { id: Number(req.params.id) } });
  if (!entry) return res.status(404).render('error', { title: 'Not Found', message: 'Budget entry not found.' });
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.render('admin/budget_form', { title: 'Edit Budget Entry', entry, events, errors: [] });
});

router.post('/budget/:id', budgetValidators, async (req, res) => {
  const id = Number(req.params.id);
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
    return res.status(400).render('admin/budget_form', { title: 'Edit Budget Entry', entry: { id, ...req.body }, events, errors: errors.array() });
  }
  const { orgRole, type, category, description, amount, entryDate, eventId } = req.body;
  await prisma.budgetEntry.update({
    where: { id },
    data: {
      orgRole,
      type,
      category,
      description,
      amount,
      entryDate: new Date(entryDate),
      eventId: eventId ? Number(eventId) : null,
    },
  });
  res.redirect('/admin/budget');
});

router.post('/budget/:id/delete', async (req, res) => {
  await prisma.budgetEntry.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.redirect('/admin/budget');
});

// ---------- Fines ----------

router.get('/fines', async (req, res) => {
  const org = ['ssg', 'nstp'].includes(req.query.org) ? req.query.org : null;
  const status = ['paid', 'unpaid'].includes(req.query.status) ? req.query.status : null;
  const [summarySsg, summaryNstp, fines] = await Promise.all([
    getFineSummary('ssg'),
    getFineSummary('nstp'),
    listFines({ orgRole: org, status }),
  ]);
  res.render('admin/fines_list', {
    title: 'Fines',
    summaries: { ssg: summarySsg, nstp: summaryNstp },
    fines,
    org,
    status,
    formatClockTime,
  });
});

router.get('/fines/export', async (req, res) => {
  const org = ['ssg', 'nstp'].includes(req.query.org) ? req.query.org : null;
  const fines = await listFines({ orgRole: org });
  const csv = buildFinesCsv(fines);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="fines_${org || 'all'}.csv"`);
  res.send(csv);
});

router.post('/fines/:id/pay', async (req, res) => {
  await markPaid(Number(req.params.id), req.session.user.id).catch(() => {});
  res.redirect('/admin/fines');
});

router.post('/fines/:id/unpay', async (req, res) => {
  await markUnpaid(Number(req.params.id)).catch(() => {});
  res.redirect('/admin/fines');
});

// ---------- Settings ----------

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Settings', errors: [], saved: req.query.saved === '1' });
});

router.post(
  '/settings',
  brandingUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'backgroundImage', maxCount: 1 },
  ]),
  [
    body('systemName').trim().notEmpty().withMessage('System name is required'),
    body('absentFee').isFloat({ min: 0 }).withMessage('Absent fee must be 0 or greater'),
    body('lateFee').isFloat({ min: 0 }).withMessage('Late fee must be 0 or greater'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render('admin/settings', { title: 'Settings', errors: errors.array(), saved: false });
    }

    const data = {
      systemName: req.body.systemName,
      absentFee: req.body.absentFee,
      lateFee: req.body.lateFee,
    };

    if (req.files?.logo?.[0]) {
      data.logoPath = `/uploads/branding/${req.files.logo[0].filename}`;
    } else if (req.body.removeLogo === 'on') {
      clearExisting('logo');
      data.logoPath = null;
    }

    if (req.files?.backgroundImage?.[0]) {
      data.backgroundImagePath = `/uploads/branding/${req.files.backgroundImage[0].filename}`;
    } else if (req.body.removeBackground === 'on') {
      clearExisting('background');
      data.backgroundImagePath = null;
    }

    await updateSettings(data);
    res.redirect('/admin/settings?saved=1');
  }
);

module.exports = router;
