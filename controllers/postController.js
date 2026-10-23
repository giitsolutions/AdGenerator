const jwt = require('jsonwebtoken');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const themeModel = require('../models/themeModel');
const instagramService = require('../services/instagramService');
const themedPostService = require('../services/themedPostService');
const config = require('../config/env');
const { buildContactBlock } = require('../utils/captionBuilder');

async function listPosts(req, res, next) {
  try {
    const posts = await postModel.getAllPosts(req.userId);
    res.json(posts);
  } catch (err) {
    next(err);
  }
}

/**
 * Build the final Instagram caption from post + campaign data.
 * Empty sections are skipped, so an absent email/WhatsApp leaves the caption unchanged.
 */
function buildFinalCaption(post, campaign) {
  const linkLine = campaign && campaign.website ? campaign.website : '🔗 Link in bio';

  const hashtags = (() => {
    try {
      const h = typeof post.hashtags === 'string' ? JSON.parse(post.hashtags) : post.hashtags;
      return Array.isArray(h) ? h.join(' ') : '';
    } catch (_) {
      return '';
    }
  })();

  const contactBlock = campaign
    ? buildContactBlock({
        email: campaign.contact_email,
        whatsappNumber: campaign.whatsapp_number,
        productName: campaign.product_name
      })
    : '';

  return [post.caption || '', post.cta || '', linkLine, contactBlock, hashtags]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * Publish a draft to Instagram.
 * The post is marked "posted" only when Instagram returns a confirmed ID.
 * Any other result throws, so the error shows on the page and the post stays a draft.
 */
async function performApproval(postId, userId) {
  const post = await postModel.getPostById(postId, userId);
  if (!post) throw new Error('Post not found');

  const campaign = await campaignModel.getCampaignById(post.campaign_id, userId);

  const imageUrl = post.image_url;
  const linkLine = campaign && campaign.website ? campaign.website : '🔗 Link in bio';
  let hashtags = '';
  try {
    const h = typeof post.hashtags === 'string' ? JSON.parse(post.hashtags) : post.hashtags;
    hashtags = Array.isArray(h) ? h.join(' ') : '';
  } catch (_) {}

  const fullCaption = `${post.caption || ''}\n\n${post.cta || ''}\n\n${linkLine}\n\n${hashtags}`.trim();

  const igResult = await instagramService.publishToInstagram({
    imageUrl,
    caption: fullCaption
  });

  // Make accepted the job — mark posted
  await postModel.markAsPosted(post.id);
  return igResult;
}

/**
 * Reject = DELETE the post.
 * If it came from a daily theme, regenerate a new version of the same theme
 * and email it again. A failed regeneration does not undo the delete.
 */
async function performRejection(postId, userId) {
  const post = await postModel.getPostById(postId, userId);
  if (!post) throw new Error('Post not found');

  const themeId = post.theme_id;
  const campaignId = post.campaign_id;

  await postModel.deletePost(postId, userId);

  if (!themeId) {
    return { deleted: true, regenerated: false };
  }

  try {
    const theme = await themeModel.getThemeById(themeId);
    const campaign = await campaignModel.getCampaignById(campaignId, userId);
    if (!theme || !campaign) {
      return { deleted: true, regenerated: false };
    }

    const { postId: newPostId, generated, imageUrl } = await themedPostService.generateThemedPost({
      campaign,
      theme
    });

    const sent = await themedPostService.emailForApproval({
      campaign,
      userEmail: config.notificationEmail,
      postId: newPostId,
      generated,
      imageUrl
    });

    return { deleted: true, regenerated: true, newPostId, emailed: sent };
  } catch (err) {
    console.error('[postController] Rejected post deleted, but regeneration failed:', err.message);
    return { deleted: true, regenerated: false };
  }
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
        ? 'Post rejected and deleted — a new version for the same theme has been generated' +
          (result.emailed ? ' and emailed' : '')
        : 'Post rejected and deleted'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Fallback for older dashboard calls. Text editing now happens in edit.html
 * (see editPostController.js), so this only returns a clear message.
 */
async function updatePostImage(req, res, next) {
  res.status(400).json({
    error: 'Edit text now opens the edit page. Use "Edit text" on the post.'
  });
}

function renderEmailResultPage(res, { success, message }) {
  res.send(`
    <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 60px;">
      <h2 style="color: ${success ? '#2ecc71' : '#e74c3c'};">${success ? '✅' : '⚠️'} ${message}</h2>
      <p>You can close this tab now.</p>
    </body></html>
  `);
}

async function approvePostViaEmail(req, res) {
  try {
    const { token } = req.query;
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.action !== 'approve') throw new Error('Invalid token action');

    await performApproval(payload.postId, payload.userId);
    renderEmailResultPage(res, {
      success: true,
      message: 'Post approved and published to Instagram!'
    });
  } catch (err) {
    renderEmailResultPage(res, {
      success: false,
      message: `Could not approve post: ${err.message}`
    });
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
        ? `Post rejected and deleted. A new version for the same theme has been generated${
            result.emailed ? ' — check your inbox shortly' : ''
          }.`
        : 'Post rejected and deleted.'
    });
  } catch (err) {
    renderEmailResultPage(res, {
      success: false,
      message: `Could not reject post: ${err.message}`
    });
  }
}

module.exports = {
  listPosts,
  approvePost,
  rejectPost,
  approvePostViaEmail,
  rejectPostViaEmail,
  updatePostImage,
  performApproval
};