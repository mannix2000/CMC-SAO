const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const { requireApiAuth, requireApiRole } = require('../middleware/apiAuth');
const { getFilterOptions, buildStudentWhere } = require('../services/students');
const { markStudentAttendance, markAttendanceTime, finalizeAttendanceForRoster } = require('../services/attendanceMarking');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, nickname: user.nickname },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

// POST /api/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;

  const valid = user && (await bcrypt.compare(password || '', user.passwordHash));
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      avatarPath: user.avatarPath,
    },
  });
});

// GET /api/me
router.get('/me', requireApiAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.apiUser.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    avatarPath: user.avatarPath,
  });
});

router.use(requireApiAuth, requireApiRole('ssg', 'nstp'));

// GET /api/events
router.get('/events', async (req, res) => {
  const events = await prisma.event.findMany({ orderBy: { eventDate: 'desc' } });
  res.json({ events });
});

// GET /api/students?q=&course=&yearLevel=&section=
router.get('/students', async (req, res) => {
  const { q = '', course = '', yearLevel = '', section = '' } = req.query;

  const [students, filterOptions] = await Promise.all([
    prisma.student.findMany({
      where: buildStudentWhere({ q, course, yearLevel, section }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    getFilterOptions(),
  ]);

  res.json({ students, filterOptions });
});

// GET /api/events/:id/attendance?q=&course=&yearLevel=&section=
// Returns the roster merged with this officer's own attendance status for the event.
router.get('/events/:id/attendance', async (req, res) => {
  const eventId = Number(req.params.id);
  const officerRole = req.apiUser.role;
  const { q = '', course = '', yearLevel = '', section = '' } = req.query;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const students = await prisma.student.findMany({
    where: buildStudentWhere({ q, course, yearLevel, section }),
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 500,
  });

  const requiresThisOrg = officerRole === 'ssg' ? event.requiresSsg : event.requiresNstp;
  if (requiresThisOrg) {
    await finalizeAttendanceForRoster({
      event,
      officerRole,
      checkedById: req.apiUser.id,
      studentIds: students.map((s) => s.id),
    });
  }

  const checks = await prisma.attendanceCheck.findMany({ where: { eventId, officerRole } });
  const checkByStudentId = new Map(checks.map((c) => [c.studentId, c]));

  res.json({
    event,
    students: students.map((s) => {
      const check = checkByStudentId.get(s.id);
      return {
        ...s,
        status: check?.status || null,
        timeInAm: check?.timeInAm || null,
        timeOutAm: check?.timeOutAm || null,
        timeInPm: check?.timeInPm || null,
        timeOutPm: check?.timeOutPm || null,
      };
    }),
  });
});

// POST /api/events/:id/attendance/:studentId  { status: "excused" | null }
// Present/Late/Absent are derived automatically from recorded times; the only manual
// override is Excused (or clearing it, with status: null, back to automatic).
router.post('/events/:id/attendance/:studentId', async (req, res) => {
  const status = req.body.status === 'excused' ? 'excused' : req.body.status === null ? null : undefined;
  if (status === undefined) return res.status(400).json({ error: 'Only excused (or clearing it) can be set manually' });

  const result = await markStudentAttendance({
    eventId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    officerRole: req.apiUser.role,
    status,
    checkedById: req.apiUser.id,
  });
  if (result.error === 'invalid_status') return res.status(400).json({ error: result.message });
  if (result.error === 'not_found') return res.status(404).json({ error: result.message });
  res.json({ ok: true, status: result.check.status });
});

// POST /api/events/:id/attendance/:studentId/time  { session: "am" | "pm", type: "in" | "out" }
// Stamps the current server time for that session's In/Out slot.
router.post('/events/:id/attendance/:studentId/time', async (req, res) => {
  const result = await markAttendanceTime({
    eventId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    officerRole: req.apiUser.role,
    session: req.body.session,
    type: req.body.type,
    checkedById: req.apiUser.id,
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

module.exports = router;
