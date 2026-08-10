require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const { attachUser, requireLogin } = require('./middleware/auth');
const { attachSettings } = require('./middleware/settings');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const officerRoutes = require('./routes/officer');
const profileRoutes = require('./routes/profile');
const apiRoutes = require('./routes/api');

const app = express();

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Stateless JSON API for the mobile app (JWT auth, no session cookie needed).
app.use('/api', apiRoutes);

app.use(
  session({
    store: new pgSession({ pool: pgPool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

app.use(attachUser);
app.use(attachSettings);

app.use('/', authRoutes);

app.get('/', requireLogin, (req, res) => {
  const role = req.session.user.role;
  if (role === 'admin') return res.redirect('/admin');
  return res.redirect('/officer/events');
});

app.use('/admin', adminRoutes);
app.use('/officer', officerRoutes);
app.use('/profile', profileRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
