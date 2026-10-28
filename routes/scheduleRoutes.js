/**
 * scheduleRoutes.js
 * POST /api/posts/:id/schedule
 * POST /api/posts/:id/unschedule
 * POST /api/posts/:id/retry
 */

const express = require('express');
const router = express.Router();
const scheduleStore = require('../models/scheduleStore');
const schedulerService = require('../services/schedulerService');

let requireAuth;
try {
  requireAuth = require('../middleware/authMiddleware').requireAuth
    || require('../middleware/authMiddleware').protect
    || require('../middleware/authMiddleware');
} catch (_) {
  requireAuth = (req, res, next) => {
    if (!req.userId && !req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

function uid(req) {
  return req.userId || req.user?.id || req.user?.userId;
}

try {
  const postController = require('../controllers/postController');
  const fn = postController.performApproval
    || postController.approvePost
    || postController.publishPost;
  if (typeof fn === 'function') {
    schedulerService.setPerformApproval(fn);
    console.log('[scheduleRoutes] performApproval wired from postController');
  } else {
    console.warn('[scheduleRoutes] Could not find performApproval — set it manually');
  }
} catch (e) {
  console.warn('[scheduleRoutes] postController not found:', e.message);
}

router.post('/:id/schedule', requireAuth, async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = uid(req);
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({ error: 'scheduledAt is required (ISO date string)' });
    }

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduledAt' });
    }
    if (when.getTime() < Date.now() - 60 * 1000) {
      return res.status(400).json({ error: 'scheduledAt must be in the future' });
    }

    const post = await scheduleStore.getPostForUser(postId, userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'posted') {
      return res.status(400).json({ error: 'Already posted' });
    }

    await scheduleStore.markAsScheduled(postId, userId, when.toISOString());

    res.json({
      message: 'Post scheduled',
      scheduledAt: when.toISOString(),
      status: 'scheduled'
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unschedule', requireAuth, async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = uid(req);

    const post = await scheduleStore.getPostForUser(postId, userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    await scheduleStore.markAsUnscheduled(postId, userId);
    res.json({ message: 'Post unscheduled', status: 'draft' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/retry', requireAuth, async (req, res, next) => {
  try {
    const postId = req.params.id;
    const userId = uid(req);

    const post = await scheduleStore.getPostForUser(postId, userId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'failed' && post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only failed or scheduled posts can be retried' });
    }

    const when = new Date(Date.now() + 60 * 1000).toISOString();
    await scheduleStore.markAsScheduled(postId, userId, when);

    res.json({ message: 'Post queued for retry', scheduledAt: when, status: 'scheduled' });
  } catch (err) {
    next(err);
  }
});

function startAutoPoster() {
  schedulerService.startAutoPoster();
}

module.exports = {
  router,
  startAutoPoster,
  setPerformApproval: schedulerService.setPerformApproval
};