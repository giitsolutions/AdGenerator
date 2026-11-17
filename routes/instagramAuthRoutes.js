const express = require('express');
const router = express.Router();
const instagramAuthController = require('../controllers/instagramAuthController');
const { requireAuth } = require('../middleware/authMiddleware');

// Facebook OAuth callback - PUBLIC (Facebook redirects here without your auth header).
// The user is identified from the signed `state` inside the controller.
router.get('/callback', instagramAuthController.handleCallback);

// Step 1 of connecting: frontend calls this (logged in) and gets back { url }.
// Body: { postId, returnTo } so the user returns to the same post and page.
router.post('/connect-url', requireAuth, instagramAuthController.getConnectUrl);

// Get Instagram connection status
router.get('/status', requireAuth, instagramAuthController.getStatus);

// Disconnect Instagram
router.post('/disconnect', requireAuth, instagramAuthController.disconnect);

module.exports = router;