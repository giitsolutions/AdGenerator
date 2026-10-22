const jwt = require('jsonwebtoken');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const themeModel = require('../models/themeModel');
const instagramService = require('../services/instagramService');
const themedPostService = require('../services/themedPostService');
const imageService = require('../services/imageService');
const config = require('../config/env');

async function listPosts(req, res, next) {
  try {
    const posts = await postModel.getAllPosts(req.userId);
    res.json(posts);
  } catch (err) {
    next(err);
  }
}

/**
 * Shared core: publishes a post to Instagram via the Make.com webhook
 * (see services/instagramService.js). Used by both the normal
 * logged-in dashboard "Approve" button AND the one-click email
 * approval link — same logic either way, just two different entry
 * points into it.
 */
async function performApproval(postId, userId) {
  const post = await postModel.getPostById(postId, userId);
  if (!post) throw new Error('Post not found');

  const campaign = await campaignModel.getCampaignById(post.campaign_id, userId);

  const imageUrl = post.image_url;
  const linkLine = campaign && campaign.website ? campaign.website : '🔗 Link in bio';
  const fullCaption = `${post.caption}\n\n${post.cta}\n\n${linkLine}\n\n${JSON.parse(post.hashtags).join(' ')}`;

   const igResult = await instagramService.publishToInstagram({ imageUrl, caption: fullCaption });
  await postModel.markAsPosted(post.id);

  // A theme only counts as "done" once its post is actually approved —
  // this is what lets the daily scheduler know it's safe to advance
  // to the next theme in the queue.
  if (post.theme_id) {
    await themeModel.markThemeUsed(post.theme_id);
  }

  return igResult;
}


/**
 * Shared core: rejects a post, and if it was generated from a daily
 * theme, immediately regenerates a FRESH take on that SAME theme and
 * emails it for approval again — so rejecting doesn't skip to the
 * next day's theme, it just retries today's until one gets approved.
 * Used by both the dashboard "Reject" button and the email link.
 */
async function performRejection(postId, userId) {
  await postModel.markAsRejected(postId);

  const post = await postModel.getPostById(postId, userId);
  if (!post?.theme_id) return { regenerated: false }; // not a themed post — nothing more to do

  const theme = await themeModel.getThemeById(post.theme_id);
  const campaign = await campaignModel.getCampaignById(post.campaign_id, userId);
  if (!theme || !campaign) return { regenerated: false };

  const { postId: newPostId, generated, imageUrl } = await themedPostService.generateThemedPost({ campaign, theme });

  // TEMPORARY (login disabled): sends to config.notificationEmail
  // instead of a real per-user email — see note in scheduler.js.
  const sent = await themedPostService.emailForApproval({
    campaign, userEmail: config.notificationEmail, postId: newPostId, generated, imageUrl
  });

  return { regenerated: true, newPostId, emailed: sent };
}

async function approvePost(req, res, next) {
  try {
    const igResult = await performApproval(req.params.id, req.userId);
    res.json({ message: 'Posted successfully', igResult });
  } catch (err) {
    next(err);
  }
}

async function rejectPost(req, res, next) {
  try {
    const result = await performRejection(req.params.id, req.userId);
    res.json({
      message: result.regenerated
        ? 'Post rejected — a new version for the same theme has been generated' + (result.emailed ? ' and emailed' : '')
        : 'Post rejected'
    });
  } catch (err) {
    next(err);
  }
}

/** Simple HTML response for links clicked directly from an email inbox. */
function renderEmailResultPage(res, { success, message }) {
  res.send(`
    <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 60px;">
      <h2 style="color: ${success ? '#2ecc71' : '#e74c3c'};">${success ? '✅' : '⚠️'} ${message}</h2>
      <p>You can close this tab now.</p>
    </body></html>
  `);
}

/**
 * Approve/reject via a signed link clicked directly from an email —
 * no login required. The token itself proves which post/user this
 * is for (see schedulers/scheduler.js for how these links are built),
 * and expires after 7 days so old emails can't be replayed forever.
 */
async function approvePostViaEmail(req, res) {
  try {
    const { token } = req.query;
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.action !== 'approve') throw new Error('Invalid token action');

    await performApproval(payload.postId, payload.userId);
    renderEmailResultPage(res, { success: true, message: 'Post approved and published to Instagram!' });
  } catch (err) {
    renderEmailResultPage(res, { success: false, message: `Could not approve post: ${err.message}` });
  }
}

async function rejectPostViaEmail(req, res) {
  try {
    const { token } = req.query;
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.action !== 'reject') throw new Error('Invalid token action');

    const result = await performRejection(payload.postId, payload.userId);
    renderEmailResultPage(res, {
      success: true,
      message: result.regenerated
        ? `Post rejected. A new version for the same theme has been generated${result.emailed ? ' — check your inbox shortly' : ''}.`
        : 'Post rejected.'
    });
  } catch (err) {
    renderEmailResultPage(res, { success: false, message: `Could not reject post: ${err.message}` });
  }
}

// ---------------------------------------------------------------------
// Edit page (public/edit.html): change the text on a draft, re-draw it on
// the SAVED background (takes about a second), optionally get a new
// background, then approve. All routes use the signed "edit" token from
// the email link, so no login is needed.
// ---------------------------------------------------------------------

// The image server takes a few minutes, so "new background" runs as a
// background job and the page polls for the result.
const backgroundJobs = new Map();

const FIELD_LIMITS = {
  headlineMain: 80,
  headlineAccent: 60,
  subheadline: 200,
  offerText: 400,
  ctaButtonLabel: 40,
  caption: 2200,
  cta: 300,
  hashtags: 1000
};

function cleanFields(body = {}) {
  const f = body.fields || body;
  const out = {};
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    out[key] = String(f[key] ?? '').trim().slice(0, max);
  }
  if (!out.headlineMain && !out.headlineAccent) throw new Error('The headline cannot be empty');

  out.hashtags = out.hashtags.split(/\s+/).filter(Boolean).map(t => (t.startsWith('#') ? t : `#${t}`));

  const count = imageService.LAYOUT_COUNT;
  const layout = parseInt(f.layoutIndex, 10);
  out.layoutIndex = Number.isInteger(layout) ? ((layout % count) + count) % count : 0;
  return out;
}

async function loadEditablePost(token) {
  if (!token) throw new Error('Missing token');
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.action !== 'edit') throw new Error('Invalid token action');

  const post = await postModel.getPostById(payload.postId, payload.userId);
  if (!post) throw new Error('Post not found');
  const campaign = await campaignModel.getCampaignById(post.campaign_id, payload.userId);
  if (!campaign) throw new Error('Campaign not found');
  return { payload, post, campaign };
}

function assertEditable(post) {
  if (post.status !== 'draft') throw new Error(`This post is already ${post.status} and can no longer be edited`);
  if (!imageService.hasBackground(post.background_file)) {
    throw new Error('This post has no saved background, so the text cannot be edited (only posts generated after the edit feature was added can be).');
  }
}

function renderParams(post, campaign, f) {
  return {
    backgroundFile: post.background_file,
    productName: campaign.product_name,
    headlineMain: f.headlineMain,
    headlineAccent: f.headlineAccent,
    subheadline: f.subheadline,
    offerText: f.offerText,
    ctaButtonLabel: f.ctaButtonLabel,
    logoUrl: campaign.logo_url,
    layoutIndex: f.layoutIndex
  };
}

async function getEditData(req, res) {
  try {
    const { post, campaign } = await loadEditablePost(req.query.token);
    res.json({
      id: post.id,
      status: post.status,
      productName: campaign.product_name,
      editable: imageService.hasBackground(post.background_file),
      canNewBackground: !!post.photo_keywords,
      backgroundBusy: backgroundJobs.get(post.id)?.status === 'running',
      imageUrl: post.image_url,
      layoutCount: imageService.LAYOUT_COUNT,
      fields: {
        headlineMain: post.headline_main || '',
        headlineAccent: post.headline_accent || '',
        subheadline: post.subheadline || '',
        offerText: post.offer_text || '',
        ctaButtonLabel: post.cta_label || '',
        caption: post.caption || '',
        cta: post.cta || '',
        hashtags: JSON.parse(post.hashtags || '[]').join(' '),
        layoutIndex: Number.isInteger(post.layout_index) ? post.layout_index : 0
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Re-draws the image with the edited text (not saved, not uploaded). */
async function renderEditPreview(req, res) {
  try {
    const { post, campaign } = await loadEditablePost(req.query.token);
    assertEditable(post);
    const f = cleanFields(req.body);
    const buffer = await imageService.renderFromBackground(renderParams(post, campaign, f));
    res.json({ image: `data:image/jpeg;base64,${buffer.toString('base64')}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Saves the edited text and the re-drawn, re-hosted image. */
async function saveEdit(req, res) {
  try {
    const { post, campaign } = await loadEditablePost(req.query.token);
    assertEditable(post);
    const f = cleanFields(req.body);

    const imageUrl = await imageService.renderAndHostFromBackground(renderParams(post, campaign, f));
    await postModel.updatePostContent(post.id, { ...f, imageUrl });
    res.json({ imageUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Publishes the (already saved) post from the edit page. */
async function approveViaEditPage(req, res) {
  try {
    const { post } = await loadEditablePost(req.query.token);
    if (post.status !== 'draft') throw new Error(`This post is already ${post.status}`);
    await performApproval(post.id, post.user_id);
    res.json({ message: 'Post approved and published to Instagram!' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Starts generating a new background (slow) and returns right away. */
async function startNewBackground(req, res) {
  try {
    const { post } = await loadEditablePost(req.query.token);
    assertEditable(post);
    if (!post.photo_keywords) throw new Error('No image description saved for this post');

    if (backgroundJobs.get(post.id)?.status === 'running') {
      return res.status(202).json({ started: false, message: 'A new background is already being generated' });
    }

    backgroundJobs.set(post.id, { status: 'running' });
    imageService
      .createNewBackground({ photoKeywords: post.photo_keywords, backgroundFile: post.background_file })
      .then(() => backgroundJobs.set(post.id, { status: 'done' }))
      .catch(err => backgroundJobs.set(post.id, { status: 'error', error: err.message }));

    res.status(202).json({ started: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getBackgroundStatus(req, res) {
  try {
    const { post } = await loadEditablePost(req.query.token);
    const job = backgroundJobs.get(post.id) || { status: 'idle' };
    if (job.status === 'done' || job.status === 'error') backgroundJobs.delete(post.id);
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Logged-in dashboard: returns the link to the edit page for a post. */
async function getEditLink(req, res, next) {
  try {
    const post = await postModel.getPostById(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ url: themedPostService.buildEmailActionLink(post.id, req.userId, 'edit') });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPosts,
  approvePost,
  rejectPost,
  approvePostViaEmail,
  rejectPostViaEmail,
  getEditData,
  renderEditPreview,
  saveEdit,
  approveViaEditPage,
  startNewBackground,
  getBackgroundStatus,
  getEditLink
};