const jwt = require('jsonwebtoken');

function requireApiAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header. Use: Bearer <token>' });
  }

  try {
    req.apiUser = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireApiRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.apiUser.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this endpoint.' });
    }
    next();
  };
}

module.exports = { requireApiAuth, requireApiRole };
