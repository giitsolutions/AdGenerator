const express = require('express');
const { getDb } = require('../db/connection');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
const MAX_BYTES = 8 * 1024 * 1024;

// List the saved photos for the logged-in user.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT id, title FROM image_library WHERE user_id = ? AND data IS NOT NULL ORDER BY id ASC',
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Save an uploaded photo. Body: { title, imageData } where imageData is a JPG/PNG data URL.
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const title = String((req.body && req.body.title) || '').trim() || 'Untitled';
    const dataUrl = String((req.body && req.body.imageData) || '');

    const m = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Choose a JPG or PNG image' });

    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'The image is empty' });
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Image must be under 8 MB' });

    const db = await getDb();
    const r = await db.run(
      'INSERT INTO image_library (user_id, title, image_url, mime_type, data) VALUES (?, ?, ?, ?, ?)',
      [req.userId, title, '', m[1], buffer]
    );
    res.json({ id: r.lastID, title });
  } catch (err) {
    next(err);
  }
});

// Delete one saved photo owned by the logged-in user.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const r = await db.run(
      'DELETE FROM image_library WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!r.changes) return res.status(404).json({ error: 'Photo not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/file/:slug', async (req, res, next) => {
  try {
    const db = await getDb();
    const row = await db.get('SELECT mime_type, data FROM image_library WHERE slug = ?', [req.params.slug]);
    if (!row || !row.data) return res.status(404).end();
    res.set('Content-Type', row.mime_type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(row.data);
  } catch (err) {
    next(err);
  }
});

// Returns the image bytes for one photo owned by the logged-in user.
router.get('/:id/image', requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT mime_type, data FROM image_library WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!row || !row.data) return res.status(404).end();
    res.set('Content-Type', row.mime_type);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(row.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;