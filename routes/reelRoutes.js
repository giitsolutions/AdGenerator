// routes/reelRoutes.js
// Mounted in server.js as: app.use('/api/posts', require('./routes/reelRoutes'))
//   GET  /api/posts/reel-campaigns
//   POST /api/posts/reel-upload
//   POST /api/posts/reel-generate

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { q } = require('../db/query');

// Upload handler (must export handleUpload)
const { handleUpload } = require('../controllers/reelController');

// Generate handler (must export generateReel)
const { generateReel } = require('../controllers/reelGenerateController');

// postController uses req.userId; some reel code uses req.user.id
function shareUserId(req, res, next) {
  const id =
    req.userId != null
      ? req.userId
      : req.user && (req.user.id || req.user.userId);
  if (id != null) {
    if (req.userId == null) req.userId = id;
    if (!req.user) req.user = { id };
  }
  next();
}

router.get('/reel-campaigns', requireAuth, shareUserId, async (req, res) => {
  try {
    const rows = await q().all(
      'SELECT id, product_name FROM campaigns WHERE user_id = ? ORDER BY id DESC',
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[reels] could not list campaigns:', err.message);
    res.status(500).json({ error: 'Could not load your campaigns' });
  }
});

router.post('/reel-upload', requireAuth, shareUserId, handleUpload);
router.post('/reel-generate', requireAuth, shareUserId, generateReel);

module.exports = router;