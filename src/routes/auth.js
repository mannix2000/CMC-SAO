const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../config/db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Log In', error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;

  const valid = user && (await bcrypt.compare(password || '', user.passwordHash));
  if (!valid) {
    return res.status(401).render('login', { title: 'Log In', error: 'Invalid username or password.' });
  }

  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      nickname: user.nickname,
      avatarPath: user.avatarPath,
    };
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
