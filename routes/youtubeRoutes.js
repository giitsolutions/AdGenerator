const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const yt = require('../controllers/youtubeController');

const router = express.Router();

router.post('/connect-url', requireAuth, yt.connectUrl);
router.get('/callback', yt.callback);
router.get('/status', requireAuth, yt.status);
router.post('/disconnect', requireAuth, yt.disconnect);
router.post('/request-approval', requireAuth, yt.requestApproval);
router.post('/upload/:postId', requireAuth, yt.upload);
router.post('/schedule/:postId', requireAuth, yt.schedule);

module.exports = router;