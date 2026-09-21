const jwt = require('jsonwebtoken');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const themeModel = require('../models/themeModel');
const instagramService = require('../services/instagramService');
const themedPostService = require('../services/themedPostService');
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

module.exports = { listPosts, approvePost, rejectPost, approvePostViaEmail, rejectPostViaEmail };
