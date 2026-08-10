const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const { requireApiAuth, requireApiRole } = require('../middleware/apiAuth');
const { getFilterOptions, buildStudentWhere } = require('../services/students');
const { markStudentAttendance } = require('../services/attendanceMarking');

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

  const [students, checks] = await Promise.all([
    prisma.student.findMany({
      where: buildStudentWhere({ q, course, yearLevel, section }),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    prisma.attendanceCheck.findMany({ where: { eventId, officerRole } }),
  ]);
  const statusByStudentId = new Map(checks.map((c) => [c.studentId, c.status]));

  res.json({
    event,
    students: students.map((s) => ({ ...s, status: statusByStudentId.get(s.id) || null })),
  });
});

// POST /api/events/:id/attendance/:studentId  { status: "present" | "absent" | "late" | "excused" }
router.post('/events/:id/attendance/:studentId', async (req, res) => {
  const result = await markStudentAttendance({
    eventId: Number(req.params.id),
    studentId: Number(req.params.studentId),
    officerRole: req.apiUser.role,
    status: req.body.status,
    checkedById: req.apiUser.id,
  });
  if (result.error === 'invalid_status') return res.status(400).json({ error: result.message });
  if (result.error === 'not_found') return res.status(404).json({ error: result.message });
  res.json({ ok: true, status: result.check.status });
});

module.exports = router;
