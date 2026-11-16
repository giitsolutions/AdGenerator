// POST /api/posts/reel-generate  { campaign_id, duration (15-30), idea?, mode?: 'auto'|'stock'|'slideshow' }
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { q } = require('../db/query');
const campaignModel = require('../models/campaignModel');
const { makeGenerated, createReelDraft, REEL_DIR } = require('./reelController');
const { generateStockVideoReel } = require('../services/stockVideoReelService');
const { generateSlideshowReel } = require('../services/slideshowReelService');
const { resolveCampaignLogo } = require('../services/reelLogo');
const { ensureDistinctHeadline } = require('../services/reelCopy');

const SOURCE_DIR = path.join(__dirname, '..', 'storage', 'reel-sources');
fs.mkdirSync(SOURCE_DIR, { recursive: true });
const configuredMaxPhotos = Number(process.env.SLIDESHOW_MAX_PHOTOS || 4);
const MAX_PHOTOS = Number.isInteger(configuredMaxPhotos) && configuredMaxPhotos > 0
  ? configuredMaxPhotos
  : 4;
const busy = new Set();

async function getPhotoBuffers(userId) {
  const rows = await q().all(
    'SELECT data FROM image_library WHERE user_id = ? AND data IS NOT NULL',
    [userId]
  );
  const photos = rows.map((row) => row.data).filter((data) => Buffer.isBuffer(data));
  for (let i = photos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [photos[i], photos[j]] = [photos[j], photos[i]];
  }
  return photos.slice(0, MAX_PHOTOS);
}

async function generateReel(req, res, next) {
  const userId = req.userId;
  const {
    campaign_id: campaignIdInput,
    duration: durationInput,
    idea,
    mode: modeInput
  } = req.body || {};
  const campaignId = Number(campaignIdInput);
  const duration = durationInput == null || durationInput === '' ? 15 : Number(durationInput);
  const mode = modeInput || 'auto';

  if (!Number.isInteger(campaignId) || campaignId < 1) {
    return res.status(400).json({ error: 'A valid campaign_id is required' });
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 30) {
    return res.status(400).json({ error: 'duration must be a whole number between 15 and 30 seconds' });
  }
  if (idea != null && typeof idea !== 'string') {
    return res.status(400).json({ error: 'idea must be a string' });
  }
  if (!['auto', 'stock', 'slideshow'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto, stock, or slideshow' });
  }
  if (userId == null) {
    return res.status(401).json({ error: 'Authentication is required' });
  }
  if (busy.has(userId)) {
    return res.status(409).json({ error: 'A reel is already being generated for this account' });
  }

  busy.add(userId);
  let tmpDir;
  let outPath;
  let sourcePath;
  let created = false;

  try {
    const campaign = await campaignModel.getCampaignById(campaignId, userId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-'));
    const logoPath = await resolveCampaignLogo(campaign, tmpDir);
    if (!logoPath) {
      return res.status(422).json({ error: 'Add a logo to the selected campaign before generating a video.' });
    }

    const generated = await makeGenerated(campaign, idea);
    Object.assign(generated, ensureDistinctHeadline(generated));
    const headline = generated.headlineMain || campaign.product_name || '';
    const overlay = {
      brand: campaign.product_name || headline,
      caption: generated.caption || '',
      headline,
      headlineMain: generated.headlineMain,
      headlineAccent: generated.headlineAccent,
      subheadline: generated.subheadline || '',
      offer: generated.offerText || campaign.offer_details || '',
      cta: generated.ctaButtonLabel || generated.cta || '',
      logoPath
    };

    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;
    outPath = path.join(REEL_DIR, filename);
    const sourceFilename = `${path.parse(filename).name}-source.mp4`;
    sourcePath = path.join(SOURCE_DIR, sourceFilename);
    let source;

    if (mode !== 'slideshow') {
      try {
        await generateStockVideoReel({
          ...overlay,
          duration,
          outPath,
          sourceOutPath: sourcePath
        });
        source = 'stock';
      } catch (error) {
        fs.rmSync(sourcePath, { force: true });
        console.warn('[reels] Stock video generation failed:', error.message);
        return res.status(502).json({
          error: `Could not find a new, unused video focused on a treadmill. Unrelated exercise footage and clips with only an incidental treadmill are not used. Please try again later or choose the slideshow option with treadmill-related photos. ${error.message}`
        });
      }
    }

    if (!source) {
      const photos = await getPhotoBuffers(userId);
      if (!photos.length) {
        return res.status(422).json({
          error: mode === 'slideshow'
            ? 'Upload at least one photo to your photo library before creating a slideshow'
            : 'No stock video was available and your photo library is empty'
        });
      }
      await generateSlideshowReel({ photos, ...overlay, duration, outPath, sourceOutPath: sourcePath });
      source = 'slideshow';
    }

    const post = await createReelDraft({
      userId,
      campaign,
      videoUrl: `/uploads/reels/${filename}`,
      videoSourceUrl: sourceFilename,
      generated
    });
    created = true;
    return res.status(201).json({ ...post, source });
  } catch (error) {
    console.error('[reels] Reel generation failed:', error);
    return next(error);
  } finally {
    busy.delete(userId);
    for (const [target, options, label] of [
      [tmpDir, { recursive: true, force: true }, 'temporary files'],
      [outPath && !created ? outPath : null, { force: true }, 'incomplete video'],
      [sourcePath && !created ? sourcePath : null, { force: true }, 'incomplete source video']
    ]) {
      if (!target) continue;
      try {
        fs.rmSync(target, options);
      } catch (error) {
        console.error(`[reels] Could not clean up ${label}:`, error);
      }
    }
  }
}

module.exports = { generateReel };
