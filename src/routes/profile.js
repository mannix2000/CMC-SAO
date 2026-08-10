const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

const AVATAR_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function clearExistingAvatar(userId) {
  const prefix = `avatar-${userId}-`;
  for (const f of fs.readdirSync(AVATAR_DIR)) {
    if (f.startsWith(prefix)) fs.unlinkSync(path.join(AVATAR_DIR, f));
  }
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      clearExistingAvatar(req.session.user.id);
      cb(null, `avatar-${req.session.user.id}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    if (!okType) return cb(new Error('Only PNG, JPEG, WEBP, or GIF images are allowed.'));
    cb(null, true);
  },
});

async function renderProfile(req, res, extra = {}) {
  const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
  res.render('profile', {
    title: 'My Profile',
    user,
    infoErrors: [],
    passwordErrors: [],
    saved: false,
    passwordSaved: false,
    ...extra,
  });
}

router.get('/', async (req, res) => {
  await renderProfile(req, res);
});

router.post(
  '/',
  avatarUpload.single('avatar'),
  [
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Must be a valid email'),
    body('nickname').optional({ checkFalsy: true }).trim().isLength({ max: 50 }).withMessage('Nickname must be 50 characters or fewer'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderProfile(req, res, {
        infoErrors: errors.array(),
        user: { ...req.session.user, ...req.body },
      });
    }

    const { username, email, nickname } = req.body;
    const data = { username, email: email || null, nickname: nickname || null };

    if (req.file) {
      data.avatarPath = `/uploads/avatars/${req.file.filename}`;
    } else if (req.body.removeAvatar === 'on') {
      clearExistingAvatar(req.session.user.id);
      data.avatarPath = null;
    }

    try {
      const updated = await prisma.user.update({ where: { id: req.session.user.id }, data });
      req.session.user.username = updated.username;
      req.session.user.nickname = updated.nickname;
      req.session.user.avatarPath = updated.avatarPath;
      await renderProfile(req, res, { saved: true });
    } catch (err) {
      const msg = err.code === 'P2002' ? 'That username or email is already taken.' : 'Could not save profile.';
      renderProfile(req, res, { infoErrors: [{ msg }], user: { ...req.session.user, ...req.body } });
    }
  }
);

router.post(
  '/password',
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
    body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('Passwords do not match'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderProfile(req, res, { passwordErrors: errors.array() });
    }

    const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!valid) {
      return renderProfile(req, res, { passwordErrors: [{ msg: 'Current password is incorrect.' }] });
    }

    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await prisma.user.update({ where: { id: req.session.user.id }, data: { passwordHash } });
    renderProfile(req, res, { passwordSaved: true });
  }
);

module.exports = router;
