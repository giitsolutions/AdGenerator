const userModel = require('../models/userModel');

/**
 * TEMPORARY: login is disabled for now (re-enable later by restoring
 * the JWT-checking version of this function — the rest of the app's
 * per-user scoping code is untouched and ready for that).
 *
 * Every request is treated as the same auto-created local account, so
 * campaigns/posts/themes/Instagram connection all keep working
 * exactly as before, just without a login step in front of them.
 */
async function requireAuth(req, res, next) {
  try {
    const user = await userModel.getOrCreateDefaultUser();
    req.userId = user.id;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
