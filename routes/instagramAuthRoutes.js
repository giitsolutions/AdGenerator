const express = require('express');
const router = express.Router();
const instagramAuthController = require('../controllers/instagramAuthController');
const { requireAuth } = require('../middleware/authMiddleware');

// These two are NOT behind requireAuth: they're plain browser
// navigations (the user clicking a link, then Facebook redirecting
// back) — no Authorization header is possible on a browser redirect.
// Identity is instead carried via the signed "state" JWT (see
// controller comments) and verified inside the controller itself.
router.get('/connect', instagramAuthController.startConnect);
router.get('/callback', instagramAuthController.handleCallback);

// This one IS a normal fetch() call from the logged-in dashboard, so
// it goes through the regular auth check.
router.post('/disconnect', requireAuth, instagramAuthController.disconnect);

module.exports = router;
