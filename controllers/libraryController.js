const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const campaignModel = require('../models/campaignModel');
const postModel = require('../models/postModel');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');

const BACKGROUND_DIR = path.join(__dirname, '../storage/backgrounds');
const MAX_BYTES = 8 * 1024 * 1024;

async function listLibrary(req, res, next) {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT id, title, image_url, slug FROM image_library WHERE user_id = ? ORDER BY id DESC',
      [req.userId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      preview: r.slug ? '/api/library/file/' + r.slug : r.image_url
    })));
  } catch (err) {
    next(err);
  }
}

// Stores the uploaded image in the database.
// Body: { title, imageData } where imageData is a data URL (JPG or PNG).
async function addLibraryImage(req, res, next) {
  try {
    const title = String((req.body && req.body.title) || '').trim() || 'Untitled';
    const dataUrl = String((req.body && req.body.imageData) || '');

    const m = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Choose a JPG or PNG image' });

    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'The image is empty' });
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Image must be under 8 MB' });

    const slug = crypto.randomBytes(12).toString('hex');
    const db = await getDb();
    const r = await db.run(
      'INSERT INTO image_library (user_id, title, image_url, mime_type, data, slug) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, title, '', m[1], buffer, slug]
    );
    res.json({ id: r.lastID });
  } catch (err) {
    next(err);
  }
}

// Public preview: the random slug is the only key, so it can't be guessed.
async function serveLibraryImage(req, res, next) {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT mime_type, data FROM image_library WHERE slug = ?',
      [req.params.slug]
    );
    if (!row || !row.data) return res.status(404).end();
    res.set('Content-Type', row.mime_type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(row.data);
  } catch (err) {
    next(err);
  }
}

async function deleteLibraryImage(req, res, next) {
  try {
    const db = await getDb();
    const r = await db.run(
      'DELETE FROM image_library WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!r.changes) return res.status(404).json({ error: 'Image not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
}

async function generateFromLibrary(req, res, next) {
  try {
    const campaign = await campaignModel.getCampaignById(req.params.campaignId, req.userId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const db = await getDb();
    const img = await db.get(
      'SELECT * FROM image_library WHERE id = ? AND user_id = ?',
      [req.body.libraryImageId, req.userId]
    );
    if (!img) return res.status(404).json({ error: 'Library image not found' });

    // Put the photo in the backgrounds folder so Edit text works later.
    const ext = img.mime_type === 'image/png' ? 'png' : 'jpg';
    const backgroundFile = `bg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    fs.mkdirSync(BACKGROUND_DIR, { recursive: true });
    const dest = path.join(BACKGROUND_DIR, backgroundFile);

    if (img.data) {
      // Image stored in the database.
      fs.writeFileSync(dest, img.data);
    } else {
      // Older library row that only has a link.
      const imgRes = await axios.get(img.image_url, { responseType: 'arraybuffer', timeout: 30000 });
      fs.writeFileSync(dest, Buffer.from(imgRes.data));
    }

    const generated = await aiService.generateAdContent({
      productName: campaign.product_name,
      audience: campaign.audience,
      tone: campaign.tone,
      offerDetails: campaign.offer_details
    });
    const ctaLabel = generated.ctaButtonLabel || generated.cta || 'Learn more';
    const postedCount = await postModel.countPostedPosts(campaign.id);
    const layoutIndex = postedCount % imageService.LAYOUT_COUNT;

    const imageUrl = await imageService.renderAndHostFromBackground({
      backgroundFile,
      productName: campaign.product_name,
      headlineMain: generated.headlineMain,
      headlineAccent: generated.headlineAccent,
      subheadline: generated.subheadline,
      offerText: generated.offerText,
      ctaButtonLabel: ctaLabel,
      logoUrl: campaign.logo_url,
      layoutIndex
    });

    const postId = await postModel.createPost({
      userId: req.userId,
      campaignId: campaign.id,
      themeId: null,
      caption: generated.caption,
      hashtags: generated.hashtags || [],
      cta: generated.cta,
      imageUrl,
      headlineMain: generated.headlineMain,
      headlineAccent: generated.headlineAccent,
      subheadline: generated.subheadline,
      offerText: generated.offerText,
      ctaLabel,
      photoKeywords: null,
      backgroundFile,
      layoutIndex
    });

    res.json({ postId, imageUrl });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLibrary,
  addLibraryImage,
  serveLibraryImage,
  deleteLibraryImage,
  generateFromLibrary
};