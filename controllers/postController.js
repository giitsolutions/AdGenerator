const jwt = require('jsonwebtoken');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const postModel = require('../models/postModel');
const campaignModel = require('../models/campaignModel');
const themeModel = require('../models/themeModel');
const instagramService = require('../services/instagramService');
const themedPostService = require('../services/themedPostService');
const config = require('../config/env');
const userModel = require('../models/userModel');
const { buildContactBlock } = require('../utils/captionBuilder');
const { createTransitionError } = require('../models/contentWorkflow');
const scheduleStore = require('../models/scheduleStore');

const IMAGE_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'images');
const IMAGE_BACKGROUND_DIR = path.join(__dirname, '..', 'storage', 'backgrounds');
const REEL_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'reels');
const REEL_SOURCE_DIR = path.join(__dirname, '..', 'storage', 'reel-sources');
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

async function reelVideoAvailable(videoUrl) {
  const prefix = '/uploads/reels/';
  if (typeof videoUrl !== 'string' || !videoUrl.startsWith(prefix)) return false;
  const filename = videoUrl.slice(prefix.length);
  if (!filename || path.basename(filename) !== filename) return false;

  try {
    await fs.access(path.join(REEL_UPLOAD_DIR, filename));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function removeRejectedReelFiles(post) {
  const assets = [
    {
      reference: post.video_url,
      prefix: '/uploads/reels/',
      directory: REEL_UPLOAD_DIR,
      isSource: false
    },
    {
      reference: post.video_source_url,
      prefix: '',
      directory: REEL_SOURCE_DIR,
      isSource: true
    }
  ];
  const warnings = [];

  for (const asset of assets) {
    const filename = asset.isSource
      ? asset.reference
      : (typeof asset.reference === 'string' && asset.reference.startsWith(asset.prefix)
        ? asset.reference.slice(asset.prefix.length)
        : '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/i.test(filename) || path.basename(filename) !== filename) {
      continue;
    }

    const isReferenced = await postModel.isVideoAssetReferenced(
      post.id,
      asset.isSource ? null : asset.reference,
      asset.isSource ? asset.reference : null
    );
    if (isReferenced) continue;

    try {
      await fs.unlink(path.join(asset.directory, filename));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[postController] Could not remove rejected Reel file ${filename}:`, error.message);
        warnings.push(filename);
      }
    }
  }

  return warnings;
}

async function uploadImagePost(req, res, next) {
  let filePath;
  let backgroundPath;
  let postCreated = false;
  try {
    const body = req.body || {};
    const campaignId = Number(body.campaign_id || body.campaignId);
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return res.status(400).json({ error: 'Select a campaign for this image post.' });
    }

    const campaign = await campaignModel.getCampaignById(campaignId, req.userId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

    const match = String(body.imageData || '').match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return res.status(400).json({ error: 'Choose a JPG or PNG image.' });
    const imageBuffer = Buffer.from(match[2], 'base64');
    if (!imageBuffer.length) return res.status(400).json({ error: 'The image is empty.' });
    if (imageBuffer.length > MAX_IMAGE_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'Image must be under 8 MB.' });
    }

    const title = String(body.title || '').trim() || 'Uploaded image';
    const extension = match[1] === 'image/png' ? 'png' : 'jpg';
    const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${extension}`;
    await fs.mkdir(IMAGE_UPLOAD_DIR, { recursive: true });
    await fs.mkdir(IMAGE_BACKGROUND_DIR, { recursive: true });
    filePath = path.join(IMAGE_UPLOAD_DIR, filename);
    backgroundPath = path.join(IMAGE_BACKGROUND_DIR, filename);
    await fs.writeFile(filePath, imageBuffer, { flag: 'wx' });
    await fs.copyFile(filePath, backgroundPath);

    const postId = await postModel.createPost({
      userId: req.userId,
      campaignId: campaign.id,
      caption: title,
      hashtags: [],
      cta: '',
      imageUrl: `/uploads/images/${filename}`,
      headlineMain: title,
      backgroundFile: filename,
      mediaType: 'image'
    });
    postCreated = true;
    res.status(201).json({ id: postId, status: 'generated', content_type: 'image' });
  } catch (err) {
    if (!postCreated) {
      for (const uploadedPath of [filePath, backgroundPath]) {
        if (uploadedPath) {
          try {
            await fs.unlink(uploadedPath);
          } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') {
              console.error('[postController] Could not clean up failed image upload:', cleanupError.message);
            }
          }
        }
      }
    }
    next(err);
  }
}

async function listPosts(req, res, next) {
  try {
    const posts = await postModel.getAllPosts(req.userId, {
      contentType: req.query.content_type || req.query.contentType,
      status: req.query.status
    });
    const postsWithMediaAvailability = await Promise.all(posts.map(async post => {
      if (post.content_type !== 'reel' && post.media_type !== 'reel' && !post.video_url) return post;
      return { ...post, video_available: await reelVideoAvailable(post.video_url) };
    }));
    res.json(postsWithMediaAvailability);
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
 * Publish a scheduled item. It is marked posted only after Instagram confirms.
 */
// Posts being published right now. Two quick clicks on the same Approve link
// would otherwise both pass the "not posted yet" check and post twice.
const publishing = new Set();

function alreadyPostedError(message) {
  const err = new Error(message);
  err.code = 'ALREADY_POSTED';
  return err;
}

async function performApproval(postId, userId) {
  const key = String(postId);
  if (publishing.has(key)) {
    throw new Error('This post is already being published — please wait a moment.');
  }
  publishing.add(key);
  try {
    const post = await postModel.getPostById(postId, userId);
    const isDraft = post && ['generated', 'ready_to_post'].includes(post.status);

    // A draft (Reel or image) is posted straight to Instagram. If that fails,
    // it goes back to Drafts with the error, so nothing is lost.
    if (isDraft) {
      await postModel.markPublishingNow(post.id, userId);
      try {
        return await publishDraft(post.id, userId);
      } catch (err) {
        if (err.code !== 'ALREADY_POSTED') {
          try {
            await postModel.revertToDraft(post.id, userId, err.message);
          } catch (revertError) {
            console.error(`[postController] Could not move post ${post.id} back to drafts:`, revertError.message);
          }
        }
        throw err;
      }
    }
    return await publishDraft(postId, userId);
  } finally {
    publishing.delete(key);
  }
}

async function publishDraft(postId, userId) {
  const post = await postModel.getPostById(postId, userId);
  if (!post) {
    const error = new Error('Post not found');
    error.status = 404;
    throw error;
  }
  if (post.status !== 'scheduled') {
    if (post.status === 'posted') throw alreadyPostedError('This post was already published.');
    throw createTransitionError(post.status, 'posted');
  }

  try {
    const campaign = await campaignModel.getCampaignById(post.campaign_id, userId);
    const linkLine = campaign && campaign.website ? campaign.website : '🔗 Link in bio';
    let hashtags = '';
    try {
      const h = typeof post.hashtags === 'string' ? JSON.parse(post.hashtags) : post.hashtags;
      hashtags = Array.isArray(h) ? h.join(' ') : '';
    } catch (_) {}

    const fullCaption = `${post.caption || ''}\n\n${post.cta || ''}\n\n${linkLine}\n\n${hashtags}`.trim();
    let igResult;
    if (post.content_type === 'reel') {
      const instagramUser = await userModel.getUserWithInstagramToken(userId);
      if (!instagramUser) {
        throw new Error('Connect an Instagram professional account before publishing a Reel');
      }
      igResult = await instagramService.publishReelToInstagram({
        videoUrl: post.video_url,
        caption: fullCaption,
        instagramBusinessAccountId: instagramUser.instagram_business_account_id,
        accessToken: instagramUser.instagram_access_token
      });
    } else {
      igResult = await instagramService.publishToInstagram({
        imageUrl: post.image_url,
        caption: fullCaption
      });
    }

    await postModel.markAsPosted(post.id, userId);

    if (post.theme_id) {
      try {
        await themeModel.markThemeUsed(post.theme_id);
      } catch (err) {
        console.error(`[postController] Post ${post.id} published, but theme ${post.theme_id} could not be marked used:`, err.message);
      }
    }
    return igResult;
  } catch (err) {
    try {
      await postModel.markAsFailed(post.id, err.message);
    } catch (recordError) {
      console.error(`[postController] Could not store publish error for post ${post.id}:`, recordError.message);
    }
    throw err;
  }
}

/**
 * Reject = DELETE the post.
 * If it came from a daily theme, regenerate a new version of the same theme
 * and email it again. A failed regeneration does not undo the delete.
 */
async function performRejection(postId, userId, { waitForRegeneration = true } = {}) {
  const post = await postModel.getPostById(postId, userId);
  if (!post) throw new Error('Post not found');
  // An old "Reject" link must never delete a post that was already approved.
  if (post.status === 'posted') {
    throw alreadyPostedError('This post was already published, so it cannot be rejected.');
  }
  if ((post.content_type === 'reel' || post.media_type === 'reel' || post.video_url) &&
      post.status !== 'generated') {
    throw createTransitionError(post.status, 'rejected');
  }

  const themeId = post.theme_id;
  const campaignId = post.campaign_id;

  const deleted = await postModel.deletePost(postId, userId);
  if (!deleted) {
    const error = new Error('Post not found.');
    error.status = 404;
    throw error;
  }
  const cleanupWarnings = post.content_type === 'reel' || post.media_type === 'reel' || post.video_url
    ? await removeRejectedReelFiles(post)
    : [];

  if (!themeId) {
    return { deleted: true, regenerated: false, regenerating: false, cleanupWarnings };
  }

  // New take on the SAME theme. Never throws: the delete above already happened.
  const regenerate = async () => {
    try {
      const theme = await themeModel.getThemeById(themeId);
      const campaign = await campaignModel.getCampaignById(campaignId, userId);
      if (!theme || !campaign) return { regenerated: false };

      return await themedPostService.runExclusive(campaign.id, async () => {
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
        return { regenerated: true, newPostId, emailed: sent };
      });
    } catch (err) {
      console.error('[postController] Rejected post deleted, but regeneration failed:', err.message);
      return { regenerated: false };
    }
  };

  // Email click: answer at once and build the new post in the background
  // (AI text + image can take minutes; a browser tab should not wait for that).
  if (!waitForRegeneration) {
    regenerate();
    return { deleted: true, regenerated: false, regenerating: true, cleanupWarnings };
  }

  return { deleted: true, regenerating: false, cleanupWarnings, ...(await regenerate()) };
}

async function approvePost(req, res, next) {
  try {
    const post = await postModel.getPostById(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    // Approve posts to Instagram right away (no Ready to Post step).
    if (!(await ensureInstagramConnected(req.userId, res, post.id))) return;
    await performApproval(post.id, req.userId);
    res.json({ message: 'Posted to Instagram', id: post.id, status: 'posted' });
  } catch (err) {
    next(err);
  }
}

async function movePostToGenerated(req, res, next) {
  try {
    await postModel.movePostToGenerated(req.params.id, req.userId);
    res.json({ message: 'Moved back to Generated', status: 'generated' });
  } catch (err) {
    next(err);
  }
}

async function rejectPost(req, res, next) {
  try {
    const result = await performRejection(req.params.id, req.userId);
    res.json({
      deleted: result.deleted,
      id: Number(req.params.id),
      message: result.regenerated
        ? 'Post rejected and deleted — a new version for the same theme has been generated' +
          (result.emailed ? ' and emailed' : '')
        : 'Post rejected and deleted',
      ...(result.cleanupWarnings.length
        ? { cleanupWarning: `The post was deleted, but these video files could not be removed: ${result.cleanupWarnings.join(', ')}` }
        : {})
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------
// Scheduling: a ready_to_post item is published automatically at the chosen time.
// ---------------------------------------------------------------------
const MAX_SCHEDULE_AHEAD_DAYS = 365;

async function schedulePost(req, res, next) {
  try {
    const post = await postModel.getPostById(req.params.id, req.userId);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (!post.image_url && !post.video_url) return res.status(400).json({ error: 'This post has no image or video yet, so it cannot be scheduled.' });

    // The browser sends the time it picked as an ISO/UTC string, so the time zone
    // of the person is already handled. ("when" is accepted too, for older callers.)
    const raw = req.body && (req.body.scheduledAt || req.body.when);
    if (!raw) return res.status(400).json({ error: 'Pick a date and time first.' });
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'That date and time is not valid.' });
    if (when.getTime() < Date.now() - 60 * 1000) {
      return res.status(400).json({ error: 'Please choose a future date and time.' });
    }
    if (when.getTime() > Date.now() + MAX_SCHEDULE_AHEAD_DAYS * 86400000) {
      return res.status(400).json({ error: 'Please choose a date within the next year.' });
    }

    await postModel.schedulePostAt(post.id, req.userId, when.toISOString());
    res.json({ message: 'Scheduled', id: post.id, status: 'scheduled', scheduled_at: when.toISOString() });
  } catch (err) {
    next(err);
  }
}

async function unschedulePost(req, res, next) {
  try {
    await postModel.unschedulePost(req.params.id, req.userId);
    const updated = await postModel.getPostById(req.params.id, req.userId);
    res.json({
      message: 'Schedule cancelled',
      id: Number(req.params.id),
      status: updated ? updated.status : 'generated'
    });
  } catch (err) {
    next(err);
  }
}

async function reschedulePost(req, res, next) {
  try {
    const raw = req.body && (req.body.scheduledAt || req.body.when);
    if (!raw) return res.status(400).json({ error: 'Pick a new date and time first.' });
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'That date and time is not valid.' });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Please choose a future date and time.' });
    }
    if (when.getTime() > Date.now() + MAX_SCHEDULE_AHEAD_DAYS * 86400000) {
      return res.status(400).json({ error: 'Please choose a date within the next year.' });
    }

    await scheduleStore.reschedulePost(req.params.id, req.userId, when.toISOString());
    res.json({
      message: 'Schedule updated',
      id: Number(req.params.id),
      status: 'scheduled',
      scheduled_at: when.toISOString()
    });
  } catch (err) {
    next(err);
  }
}

async function retryScheduledPost(req, res, next) {
  try {
    await postModel.requeueFailedPost(req.params.id, req.userId);
    res.json({ message: 'Queued for retry', id: Number(req.params.id), status: 'scheduled' });
  } catch (err) {
    next(err);
  }
}

// Data for public/schedule.html (calendar + list of the user's posts)
async function scheduleOverview(req, res, next) {
  try {
    res.json({ posts: await postModel.getAllPosts(req.userId, {
      contentType: req.query.content_type || req.query.contentType,
      status: req.query.status
    }) });
  } catch (err) {
    next(err);
  }
}

async function scheduleCalendar(req, res, next) {
  try {
    const contentType = req.query.content_type || req.query.contentType;
    const from = req.query.from;
    const to = req.query.to;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (!['image', 'reel'].includes(contentType)) {
      return res.status(400).json({ error: 'content_type must be either "image" or "reel".' });
    }
    if (!from || !to || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
      return res.status(400).json({ error: 'from and to must be valid dates, with from before to.' });
    }

    const posts = await postModel.getAllPosts(req.userId, {
      contentType,
      statuses: ['scheduled', 'posted'],
      dateRange: { from: fromDate, to: toDate }
    });
    res.json({ posts });
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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderEmailResultPage(res, { success, message }) {
  res.send(`
    <html><head><meta charset="utf-8"><title>KwikPost</title></head>
    <body style="font-family: Arial, sans-serif; text-align: center; padding: 60px;">
      <h2 style="color: ${success ? '#2ecc71' : '#e74c3c'};">${success ? '✅' : '⚠️'} ${escapeHtml(message)}</h2>
      <p>You can close this tab now.</p>
    </body></html>
  `);
}

async function approvePostViaEmail(req, res) {
  try {
    const { token } = req.query;
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.action !== 'approve') throw new Error('Invalid token action');

    await postModel.markReadyToPost(payload.postId, payload.userId);
    renderEmailResultPage(res, {
      success: true,
      message: 'Post approved and ready to schedule.'
    });
  } catch (err) {
    if (err.code === 'ALREADY_POSTED') {
      return renderEmailResultPage(res, { success: true, message: 'This post was already published to Instagram.' });
    }
    res.status(err.status || 400);
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

    const result = await performRejection(payload.postId, payload.userId, { waitForRegeneration: false });
    renderEmailResultPage(res, {
      success: true,
      message: result.regenerating
        ? 'Post rejected and deleted. A new version for the same theme is being generated — check your inbox in a few minutes.'
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
  uploadImagePost,
  approvePost,
  movePostToGenerated,
  rejectPost,
  approvePostViaEmail,
  rejectPostViaEmail,
  updatePostImage,
  schedulePost,
  reschedulePost,
  unschedulePost,
  retryScheduledPost,
  scheduleOverview,
  scheduleCalendar,
  performApproval,
  performRejection
};