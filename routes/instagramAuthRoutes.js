const express = require('express');
const router = express.Router();
const instagramAuthController = require('../controllers/instagramAuthController');
const { requireAuth } = require('../middleware/authMiddleware');

// Start OAuth flow - user clicks "Connect Instagram"
// Can be called with token in query or Bearer token in header
router.get('/auth/start', instagramAuthController.startConnect);

// Facebook OAuth callback - public endpoint
router.get('/callback', instagramAuthController.handleCallback);

// Get Instagram connection status
router.get('/status', requireAuth, instagramAuthController.getStatus);

// Disconnect Instagram
router.post('/disconnect', requireAuth, instagramAuthController.disconnect);

module.exports = router;