function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to view this page.',
      });
    }
    next();
  };
}

module.exports = { attachUser, requireLogin, requireRole };
