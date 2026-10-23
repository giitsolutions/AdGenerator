const jwt = require('jsonwebtoken');
const config = require('../config/env');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const imageService = require('../services/imageService');
const postController = require('./postController');

const LAYOUT_COUNT = imageService.LAYOUT_COUNT;

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

// GET /api/posts/edit-data?token=...
async function getEditData(req, res, next) {
  try {
    const { post, campaign } = await loadFromToken(req);
    res.json({
      productName: campaign ? campaign.product_name : '',
      status: post.status || 'draft',
      editable: imageService.hasBackground(post.background_file),
      layoutCount: LAYOUT_COUNT,
      canNewBackground: false,
      backgroundBusy: false,
      imageUrl: post.image_url,
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
    const image = await renderFromFields(post, campaign, (req.body && req.body.fields) || {});
    res.json({ image });
  } catch (err) {
    next(err);
  }
}

// POST /api/posts/edit-save?token=...   body: { fields }
async function save(req, res, next) {
  try {
    const { post, campaign } = await loadFromToken(req);
    if (post.status && post.status !== 'draft') {
      throw httpError(400, 'Only draft posts can be edited.');
    }

    const f = (req.body && req.body.fields) || {};
    const imageUrl = await renderFromFields(post, campaign, f);

    await postModel.updatePostContent(post.id, {
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

    res.json({ imageUrl });
  } catch (err) {
    next(err);
  }
}

// POST /api/posts/edit-approve?token=...
// The page saves first, so this only publishes the saved post.
async function approve(req, res, next) {
  try {
    const { payload, post } = await loadFromToken(req);
    if (post.status && post.status !== 'draft') {
      throw httpError(400, 'This post is already ' + post.status + '.');
    }
    if (typeof postController.performApproval !== 'function') {
      throw httpError(501, 'Publishing from this page is not connected yet. Approve the post from the dashboard instead.');
    }
    await postController.performApproval(post.id, payload.userId);
    res.json({ message: 'Post approved and published to Instagram!' });
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