const { getSettings } = require('../services/settings');

async function attachSettings(req, res, next) {
  res.locals.settings = await getSettings();
  next();
}

module.exports = { attachSettings };
