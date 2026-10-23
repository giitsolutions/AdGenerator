const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

// Registers a route only if the handler exists, so one missing name can't crash the server.
function safe(method, path, ...handlers) {
  const fns = handlers.filter(function (h) { return typeof h === 'function'; });
  if (fns.length !== handlers.length) {
    console.warn('[authRoutes] Skipped ' + method.toUpperCase() + ' ' + path + ' (handler missing)');
    return;
  }
  router[method](path, ...fns);
}

// ===== PUBLIC ROUTES =====
safe('post', '/signup', authController.signup);
safe('post', '/login', authController.login);

// Password reset (both paths supported)
safe('post', '/reset-request', authController.requestPasswordReset);
safe('post', '/forgot-password', authController.requestPasswordReset);
safe('post', '/reset-password', authController.resetPassword);

// ===== PROTECTED ROUTES =====
safe('get', '/me', requireAuth, authController.getMe);
safe('patch', '/profile', requireAuth, authController.updateProfile);
safe('post', '/change-password', requireAuth, authController.changePassword);
safe('delete', '/account', requireAuth, authController.deleteAccount);

module.exports = router;