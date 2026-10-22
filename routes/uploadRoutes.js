const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
const LOGO_DIR = path.join(__dirname, '../public/logos');

router.use(requireAuth);

// The browser sends the image file itself as the request body.
// Whatever the format (PNG, JPG, WebP, SVG, AVIF...), it is converted
// to a PNG that fits inside 400x400 (nothing is cropped), so the logo
// always works for the ad image.
router.post('/logo', express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No image received' });
    }
    const png = await sharp(req.body, { density: 300 })
      .resize({ width: 400, height: 400, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    fs.mkdirSync(LOGO_DIR, { recursive: true });
    const name = `logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
    fs.writeFileSync(path.join(LOGO_DIR, name), png);
    res.json({ path: `/logos/${name}` });
  } catch (err) {
    res.status(400).json({ error: 'That file could not be read as an image' });
  }
});

module.exports = router;