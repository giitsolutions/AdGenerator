const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const LOGO_DIR = path.join(__dirname, '..', 'public', 'logos');
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Choose a PNG, JPEG, or WebP logo image'));
      return;
    }
    callback(null, true);
  }
}).single('logo');

function uploadCampaignLogo(req, res, next) {
  upload(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'Logo image must be 5 MB or smaller'
        : uploadError.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose a logo image to upload' });

    let normalizedLogo;
    try {
      normalizedLogo = await sharp(req.file.buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch (error) {
      return res.status(400).json({ error: 'The selected file is not a valid supported logo image' });
    }

    if (normalizedLogo.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'The processed logo image must be 10 MB or smaller' });
    }

    const filename = `campaign-${crypto.randomBytes(16).toString('hex')}.png`;
    try {
      await fs.promises.mkdir(LOGO_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(LOGO_DIR, filename), normalizedLogo, { flag: 'wx' });
      return res.status(201).json({ logoUrl: `/logos/${filename}` });
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { uploadCampaignLogo };
