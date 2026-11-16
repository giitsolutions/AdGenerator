const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { q } = require('../db/query');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const aiService = require('../services/aiService');
const { resolveCampaignLogo } = require('../services/reelLogo');
const { renderUploadReelOverlay } = require('../services/reelOverlay');
const { getVideoDimensions, overlayLogoOnVideo } = require('../services/reelRender');
const config = require('../config/env');
const { createFreshHeadline, ensureDistinctHeadline, hasRepeatedHeadline } = require('../services/reelCopy');

const MAX_MB = config.reels.maxFileSizeBytes / 1024 / 1024;
const MAX_SECONDS = config.reels.maxDurationSeconds;
const REEL_DIR = path.join(__dirname, '..', 'public', 'uploads', 'reels');
const SOURCE_DIR = path.join(__dirname, '..', 'storage', 'reel-sources');
fs.mkdirSync(REEL_DIR, { recursive: true });
fs.mkdirSync(SOURCE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: REEL_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'video/mp4' && path.extname(file.originalname).toLowerCase() === '.mp4';
    cb(ok ? null : new Error('Only MP4 videos are allowed'), ok);
  },
}).single('video');

// Real MP4 files have "ftyp" at bytes 4-8 (blocks renamed files).
function looksLikeMp4(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    return buf.slice(4, 8).toString() === 'ftyp';
  } finally {
    fs.closeSync(fd);
  }
}

// Read the duration from FFmpeg's input metadata; ffprobe is not required.
function getDuration(file) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true }, (error, _out, stderr) => {
      if (error && error.code === 'ENOENT') {
        reject(new Error('FFmpeg is unavailable; reinstall the application dependencies'));
        return;
      }
      const match = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) {
        resolve(null);
        return;
      }
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
}

const userIdOf = (req) => req.user && (req.user.id || req.user.userId);

// Same AI call the photo generator uses: caption, hashtags, headline, offer, button, photo keywords.
async function makeGenerated(campaign, idea) {
  const recentReelCopy = await postModel.getRecentReelCopy(campaign.id);
  let generated;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await aiService.generateAdContent({
        productName: campaign.product_name,
        audience: campaign.audience,
        tone: campaign.tone,
        offerDetails: campaign.offer_details,
        theme: idea || '',
        isReel: true,
        recentReelCopy
      });
      generated = candidate;
      if (!hasRepeatedHeadline(candidate, recentReelCopy)) break;
    }
  } catch (e) {
    console.warn('[reels] AI text failed, using a simple caption:', e.message);
    generated = {
      caption: [campaign.offer_details, `Discover ${campaign.product_name}`, campaign.website].filter(Boolean).join('\n'),
      hashtags: [], cta: '', headlineMain: campaign.product_name, offerText: campaign.offer_details,
    };
  }

  if (!generated || hasRepeatedHeadline(generated, recentReelCopy)) {
    const subheadline = 'Treadmill workouts that fit your day';
    const recentWithFallback = [...recentReelCopy, { subheadline }];
    Object.assign(generated || (generated = {}), createFreshHeadline(recentWithFallback), { subheadline });
  }
  Object.assign(generated, ensureDistinctHeadline(generated, recentReelCopy));
  // One of the 8 overlay layouts, chosen at random for every new reel.
  generated.layoutIndex = Math.floor(Math.random() * 8);
  return generated;
}

// Creates the Reel (status 'generated') the same way an image item is created, then marks its media type.
async function createReelDraft({ userId, campaign, videoUrl, videoSourceUrl, generated }) {
  const g = generated || (await makeGenerated(campaign, ''));
  const postId = await postModel.createPost({
    userId, campaignId: campaign.id, themeId: null,
    caption: g.caption || '', hashtags: g.hashtags || [], cta: g.cta || '', imageUrl: null,
    headlineMain: g.headlineMain, headlineAccent: g.headlineAccent, subheadline: g.subheadline,
    offerText: g.offerText, ctaLabel: g.ctaButtonLabel, photoKeywords: g.photoKeywords,
    layoutIndex: Number.isInteger(g.layoutIndex) ? g.layoutIndex : 0,
    mediaType: 'reel', videoUrl, videoSourceUrl,
  });
  return postModel.getPostById(postId, userId);
}

function handleUpload(req, res) {
  upload(req, res, async (err) => {
    let tmpDir;
    let brandedPath;
    let sourcePath;
    let keepUploadedFile = false;

    function cleanupFile(file) {
      if (!file) return;
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        console.error('[reels] Could not clean up uploaded file:', error);
      }
    }

    try {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `Video too large (max ${MAX_MB}MB)` : err.message;
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: 'No video uploaded (field name: video)' });
      if (!looksLikeMp4(req.file.path)) {
        return res.status(400).json({ error: 'File is not a valid MP4' });
      }

      const dur = await getDuration(req.file.path);
      if (!Number.isFinite(dur) || dur <= 0) {
        return res.status(400).json({ error: 'Could not read the uploaded video duration' });
      }
      if (dur > MAX_SECONDS) {
        return res.status(400).json({ error: `Reel too long (max ${MAX_SECONDS}s)` });
      }

      const userId = userIdOf(req);
      const campaign = await campaignModel.getCampaignById(req.body.campaign_id, userId);
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

      const generated = await makeGenerated(campaign, req.body.idea);
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-upload-'));
      const logoPath = await resolveCampaignLogo(campaign, tmpDir);
      const { width, height } = await getVideoDimensions(req.file.path);
      const overlayPath = path.join(tmpDir, 'reel-overlay.png');
      fs.writeFileSync(overlayPath, await renderUploadReelOverlay({
        width,
        height,
        logoPath,
        brand: campaign.product_name,
        headline: campaign.product_name,
        headlineMain: generated.headlineMain,
        headlineAccent: generated.headlineAccent,
        subheadline: generated.subheadline,
        offer: generated.offerText || campaign.offer_details || '',
        cta: generated.ctaButtonLabel || generated.cta || '',
        layoutIndex: generated.layoutIndex
      }));
      sourcePath = path.join(SOURCE_DIR, `${path.parse(req.file.filename).name}-source.mp4`);
      fs.copyFileSync(req.file.path, sourcePath);
      brandedPath = `${req.file.path}.branded.mp4`;
      await overlayLogoOnVideo({ videoPath: req.file.path, overlayPath, outPath: brandedPath });
      fs.copyFileSync(brandedPath, req.file.path);

      const post = await createReelDraft({
        userId,
        campaign,
        videoUrl: `/uploads/reels/${req.file.filename}`,
        videoSourceUrl: path.basename(sourcePath),
        generated
      });
      keepUploadedFile = true;
      return res.status(201).json(post);
    } catch (e) {
      console.error('[reels] upload failed:', e);
      return res.status(500).json({ error: `Reel upload failed: ${e.message}` });
    } finally {
      cleanupFile(brandedPath);
      if (!keepUploadedFile && req.file) cleanupFile(req.file.path);
      if (!keepUploadedFile) cleanupFile(sourcePath);
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (error) {
          console.error('[reels] Could not clean up temporary logo files:', error);
        }
      }
    }
  });
}

module.exports = { handleUpload, makeGenerated, createReelDraft, REEL_DIR };