const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const imageService = require('../services/imageService');
const { renderReelOverlay } = require('../services/reelOverlay');
const { resolveCampaignLogo } = require('../services/reelLogo');
const { getVideoDimensions, overlayLogoOnVideo } = require('../services/reelRender');

const LAYOUT_COUNT = imageService.LAYOUT_COUNT;
const REEL_DIR = path.join(__dirname, '..', 'public', 'uploads', 'reels');
const REEL_SOURCE_DIR = path.join(__dirname, '..', 'storage', 'reel-sources');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function clampLayout(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 && n < LAYOUT_COUNT ? n : 0;
}

// Stored hashtags are a JSON array string, e.g. '["#gym","#fit"]'.
function hashtagsToText(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.join(' ') : '';
  } catch (e) {
    return '';
  }
}

// Text from the edit page becomes an array, which postModel stores as JSON.
function parseHashtags(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

// Dashboard: create a 2-hour link to edit one post.
async function createEditLink(req, res, next) {
  try {
    const post = await postModel.getPostById(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const token = jwt.sign(
      { action: 'edit', postId: post.id, userId: req.userId },
      config.jwtSecret,
      { expiresIn: '2h' }
    );
    res.json({ url: '/edit.html?token=' + encodeURIComponent(token) });
  } catch (err) {
    next(err);
  }
}

// The token in the URL replaces login on edit.html.
async function loadFromToken(req) {
  let payload;
  try {
    payload = jwt.verify(req.query.token || '', config.jwtSecret);
  } catch (e) {
    throw httpError(401, 'This edit link has expired. Open the post again from the dashboard.');
  }
  if (payload.action !== 'edit' || !payload.postId) {
    throw httpError(401, 'Invalid edit link.');
  }

  const post = await postModel.getPostById(payload.postId, payload.userId);
  if (!post) throw httpError(404, 'Post not found');

  const campaign = await campaignModel.getCampaignById(post.campaign_id, payload.userId);
  return { payload, post, campaign };
}

// Redraws the post on its saved background and uploads the result. Returns a URL.
async function renderFromFields(post, campaign, fields) {
  if (!imageService.hasBackground(post.background_file)) {
    throw httpError(400, 'This post has no saved background, so its text cannot be edited.');
  }
  return imageService.renderAndHostFromBackground({
    backgroundFile: post.background_file,
    productName: campaign ? campaign.product_name : '',
    headlineMain: fields.headlineMain || '',
    headlineAccent: fields.headlineAccent || '',
    subheadline: fields.subheadline || '',
    offerText: fields.offerText || '',
    ctaButtonLabel: fields.ctaButtonLabel || 'Learn more',
    logoUrl: campaign ? campaign.logo_url : null,
    layoutIndex: clampLayout(fields.layoutIndex)
  });
}

function getReelFile(url) {
  const prefix = '/uploads/reels/';
  if (typeof url !== 'string' || !url.startsWith(prefix)) {
    throw httpError(400, 'This Reel does not have a supported video file.');
  }
  const file = path.join(REEL_DIR, path.basename(url));
  if (!fs.existsSync(file)) throw httpError(404, 'The Reel video file could not be found.');
  return file;
}

async function renderReelFromFields(post, campaign, fields, isPreview) {
  if (!post.video_source_url) {
    throw httpError(400, 'This Reel was created before text editing was available. Create a new Reel to edit its video text.');
  }

  const sourceReference = path.basename(post.video_source_url);
  if (sourceReference !== post.video_source_url) {
    throw httpError(400, 'This Reel has an invalid source video reference.');
  }
  const sourcePath = path.join(REEL_SOURCE_DIR, sourceReference);
  if (!fs.existsSync(sourcePath)) throw httpError(404, 'The Reel source video could not be found.');
  const sourceBase = path.basename(sourcePath, '.mp4');
  const outputFilename = `${isPreview ? 'preview' : 'edited'}-${sourceBase}-${crypto.randomBytes(5).toString('hex')}.mp4`;
  const outputPath = path.join(REEL_DIR, outputFilename);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-edit-'));

  try {
    const logoPath = await resolveCampaignLogo(campaign || {}, tempDir);
    const { width, height } = await getVideoDimensions(sourcePath);
    const overlayPath = path.join(tempDir, 'overlay.png');
    fs.writeFileSync(overlayPath, await renderReelOverlay({
      width,
      height,
      logoPath,
      brand: campaign && campaign.product_name,
      headlineMain: fields.headlineMain || '',
      headlineAccent: fields.headlineAccent || '',
      subheadline: fields.subheadline || '',
      offer: fields.offerText || '',
      cta: fields.ctaButtonLabel || '',
      layoutIndex: clampLayout(fields.layoutIndex)
    }));
    await overlayLogoOnVideo({ videoPath: sourcePath, overlayPath, outPath: outputPath });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (isPreview) {
    const cleanup = setTimeout(() => {
      fs.rm(outputPath, { force: true }, error => {
        if (error) console.error('[reels] Could not clean up preview video:', error.message);
      });
    }, 10 * 60 * 1000);
    cleanup.unref();
  }

  return `/uploads/reels/${outputFilename}`;
}

// GET /api/posts/edit-data?token=...
async function getEditData(req, res, next) {
  try {
    const { post, campaign } = await loadFromToken(req);
    const isReel = post.media_type === 'reel' || !!post.video_url;
    res.json({
      productName: campaign ? campaign.product_name : '',
      status: post.status || 'generated',
      mediaType: isReel ? 'reel' : 'image',
      editable: isReel
        ? !!post.video_source_url && path.basename(post.video_source_url) === post.video_source_url &&
          fs.existsSync(path.join(REEL_SOURCE_DIR, post.video_source_url))
        : imageService.hasBackground(post.background_file),
      layoutCount: LAYOUT_COUNT,
      canNewBackground: false,
      backgroundBusy: false,
      imageUrl: post.image_url,
      videoUrl: post.video_url,
      fields: {
        headlineMain: post.headline_main || '',
        headlineAccent: post.headline_accent || '',
        subheadline: post.subheadline || '',
        offerText: post.offer_text || '',
        ctaButtonLabel: post.cta_label || '',
        caption: post.caption || '',
        cta: post.cta || '',
        hashtags: hashtagsToText(post.hashtags),
        layoutIndex: clampLayout(post.layout_index)
      }
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/posts/edit-preview?token=...   body: { fields }
// Redraws the image without saving the new text.
async function preview(req, res, next) {
  try {
    const { post, campaign } = await loadFromToken(req);
    const fields = (req.body && req.body.fields) || {};
    if (post.media_type === 'reel' || post.video_url) {
      const videoUrl = await renderReelFromFields(post, campaign, fields, true);
      return res.json({ videoUrl });
    }
    const image = await renderFromFields(post, campaign, fields);
    res.json({ image });
  } catch (err) {
    next(err);
  }
}

// POST /api/posts/edit-save?token=...   body: { fields }
async function save(req, res, next) {
  try {
    const { post, campaign } = await loadFromToken(req);
    if (post.status !== 'generated') {
      throw httpError(409, `Only generated posts can be edited (current status: ${post.status}).`);
    }

    const f = (req.body && req.body.fields) || {};
    if (post.media_type === 'reel' || post.video_url) {
      const videoUrl = await renderReelFromFields(post, campaign, f, false);
      try {
        await postModel.updateReelContent(post.id, post.user_id, {
          ...f,
          layoutIndex: clampLayout(f.layoutIndex),
          hashtags: parseHashtags(f.hashtags),
          videoUrl
        });
      } catch (error) {
        fs.rmSync(getReelFile(videoUrl), { force: true });
        throw error;
      }
      if (post.video_url && post.video_url !== videoUrl) {
        try {
          fs.rmSync(getReelFile(post.video_url), { force: true });
        } catch (error) {
          console.error('[reels] Could not clean up the replaced video:', error.message);
        }
      }
      return res.json({ videoUrl, status: 'ready_to_post' });
    }
    const imageUrl = await renderFromFields(post, campaign, f);

    await postModel.updatePostContent(post.id, post.user_id, {
      caption: f.caption || '',
      hashtags: parseHashtags(f.hashtags),
      cta: f.cta || '',
      headlineMain: f.headlineMain || '',
      headlineAccent: f.headlineAccent || '',
      subheadline: f.subheadline || '',
      offerText: f.offerText || '',
      ctaButtonLabel: f.ctaButtonLabel || '',
      layoutIndex: clampLayout(f.layoutIndex),
      imageUrl
    });
    res.json({ imageUrl, status: 'ready_to_post' });
  } catch (err) {
    next(err);
  }
}

// POST /api/posts/edit-approve?token=...
// The page saves first, advancing it to ready_to_post; approval does not publish immediately.
async function approve(req, res, next) {
  try {
    const { payload, post } = await loadFromToken(req);
    if (post.status !== 'ready_to_post') {
      await postModel.markReadyToPost(post.id, payload.userId);
    }
    res.json({ message: 'Post approved and ready to schedule.', status: 'ready_to_post' });
  } catch (err) {
    next(err);
  }
}

// Background regeneration is not supported yet, so the page reports idle.
async function backgroundStatus(req, res, next) {
  try {
    await loadFromToken(req);
    res.json({ status: 'idle' });
  } catch (err) {
    next(err);
  }
}

async function newBackground(req, res, next) {
  try {
    await loadFromToken(req);
    next(httpError(400, 'Changing the background is not available yet.'));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createEditLink,
  getEditData,
  preview,
  save,
  approve,
  backgroundStatus,
  newBackground
};