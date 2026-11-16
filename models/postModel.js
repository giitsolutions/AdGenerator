const { getDb } = require('../db/connection');
const { CONTENT_STATUSES, createTransitionError } = require('./contentWorkflow');

/**
 * One-time setup (runs once per server start, safe to repeat):
 *  1. adds the posts.edited column (1 = the video was changed in the editor)
 *  2. moves anything left in "ready_to_post" back to drafts, because
 *     there is no Ready to Post step any more (Reels or images).
 */
let editedColumnReady = null;
function ensureEditedColumn() {
  if (!editedColumnReady) {
    editedColumnReady = (async () => {
      const db = await getDb();
      const columns = await db.all('PRAGMA table_info(posts)');
      if (!columns.some(column => column.name === 'edited')) {
        await db.run('ALTER TABLE posts ADD COLUMN edited INTEGER NOT NULL DEFAULT 0');
      }
      await db.run(
        `UPDATE posts SET status = 'generated'
         WHERE status = 'ready_to_post'`
      );
    })().catch(error => {
      editedColumnReady = null;
      throw error;
    });
  }
  return editedColumnReady;
}

/**
 * Creates a generated item. Reels: pass mediaType: 'reel' and
 * videoUrl (and optionally videoSourceUrl / videoThumbUrl). Needs the reel columns from
 * db/reelMigration.js (ensureReelColumns) — if they are missing the half-made
 * draft is removed again and a clear error is thrown.
 */
async function createPost({
  userId, campaignId, themeId, caption, hashtags, cta, imageUrl,
  headlineMain, headlineAccent, subheadline, offerText, ctaLabel,
  photoKeywords, backgroundFile, layoutIndex,
  mediaType, videoUrl, videoSourceUrl, videoThumbUrl
}) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO posts (
       user_id, campaign_id, theme_id, caption, hashtags, cta, image_url,
       headline_main, headline_accent, subheadline, offer_text, cta_label,
       photo_keywords, background_file, layout_index, status, content_type
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?)`,
    [
      userId, campaignId, themeId || null, caption, JSON.stringify(hashtags), cta, imageUrl || null,
      headlineMain || null, headlineAccent || null, subheadline || null, offerText || null, ctaLabel || null,
      photoKeywords || null, backgroundFile || null, Number.isInteger(layoutIndex) ? layoutIndex : null,
      mediaType === 'reel' ? 'reel' : 'image'
    ]
  );
  const id = result.lastID;

  if (mediaType === 'reel') {
    try {
      await db.run(
        `UPDATE posts SET media_type = 'reel', video_url = ?, video_source_url = ?, video_thumb_url = ? WHERE id = ?`,
        [videoUrl || null, videoSourceUrl || null, videoThumbUrl || null, id]
      );
    } catch (err) {
      await db.run('DELETE FROM posts WHERE id = ?', [id]);
      throw new Error(`Could not save the Reel (${err.message}). Run ensureReelColumns() once so posts has media_type / video_url.`);
    }
  }
  return id;
}

/**
 * True if this campaign has a themed post still waiting on a
 * decision (not yet approved or rejected). Used by the daily
 * scheduler to avoid pulling the next theme while a previous one is
 * still pending in the user's inbox.
 */
async function hasPendingThemedPost(campaignId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id FROM posts
     WHERE campaign_id = ?
       AND theme_id IS NOT NULL
       AND status IN ('generated', 'ready_to_post', 'scheduled')
     LIMIT 1`,
    [campaignId]
  );
  return !!row;
}

/**
 * True if this campaign has ANY post (themed or not) still waiting on a
 * decision. The daily job uses it for campaigns without a theme queue, so
 * unanswered emails do not pile up one new draft per day.
 */
async function hasPendingDraft(campaignId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id FROM posts
     WHERE campaign_id = ?
       AND status IN ('generated', 'ready_to_post', 'scheduled')
     LIMIT 1`,
    [campaignId]
  );
  return !!row;
}

/**
 * How many posts have actually been published for this campaign.
 * Used to pick the ad layout: it only changes after a post goes live,
 * so rejected / regenerated drafts keep the same layout.
 */
async function countPostedPosts(campaignId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM posts WHERE campaign_id = ? AND status = 'posted'`,
    [campaignId]
  );
  return row ? row.total : 0;
}

async function getAllPosts(userId, filters = {}) {
  await ensureEditedColumn();
  const db = await getDb();
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (filters.contentType != null && filters.contentType !== '') {
    if (!['image', 'reel'].includes(filters.contentType)) {
      const error = new Error('content_type must be either "image" or "reel".');
      error.status = 400;
      throw error;
    }
    conditions.push('content_type = ?');
    params.push(filters.contentType);
  }

  if (filters.status != null && filters.status !== '') {
    if (!CONTENT_STATUSES.includes(filters.status)) {
      const error = new Error(`status must be one of: ${CONTENT_STATUSES.join(', ')}.`);
      error.status = 400;
      throw error;
    }
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (filters.statuses != null) {
    if (!Array.isArray(filters.statuses) ||
        filters.statuses.length === 0 ||
        filters.statuses.some(status => !CONTENT_STATUSES.includes(status))) {
      const error = new Error(`statuses must contain one or more of: ${CONTENT_STATUSES.join(', ')}.`);
      error.status = 400;
      throw error;
    }
    conditions.push(`status IN (${filters.statuses.map(() => '?').join(', ')})`);
    params.push(...filters.statuses);
  }

  if (filters.dateRange != null) {
    const from = new Date(filters.dateRange.from);
    const to = new Date(filters.dateRange.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      const error = new Error('dateRange must contain valid from and to dates, with from before to.');
      error.status = 400;
      throw error;
    }
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    conditions.push(`(
      (status = 'scheduled' AND scheduled_at IS NOT NULL
        AND datetime(scheduled_at) >= datetime(?) AND datetime(scheduled_at) < datetime(?))
      OR
      (status = 'posted'
        AND datetime(COALESCE(posted_at, created_at)) >= datetime(?)
        AND datetime(COALESCE(posted_at, created_at)) < datetime(?))
    )`);
    params.push(fromIso, toIso, fromIso, toIso);
  }

  return db.all(
    `SELECT * FROM posts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
}

async function getPostById(id, userId) {
  const db = await getDb();
  return db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
}

async function getRecentReelCopy(campaignId, limit = 30) {
  const db = await getDb();
  return db.all(
    `SELECT substr(headline_main, 1, 120) AS headline_main,
            substr(headline_accent, 1, 120) AS headline_accent,
            substr(subheadline, 1, 160) AS subheadline
     FROM posts
     WHERE campaign_id = ? AND content_type = 'reel'
     ORDER BY id DESC
     LIMIT ?`,
    [campaignId, limit]
  );
}

async function invalidTransitionForPost(id, userId, nextStatus) {
  const db = await getDb();
  const post = userId == null
    ? await db.get('SELECT status FROM posts WHERE id = ?', [id])
    : await db.get('SELECT status FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
  if (!post) {
    const error = new Error('Post not found');
    error.status = 404;
    throw error;
  }
  throw createTransitionError(post.status, nextStatus);
}

/** Saves edited content. The post STAYS a draft and is marked edited = 1. */
async function updatePostContent(id, userId, f) {
  await ensureEditedColumn();
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts SET
       caption = ?, hashtags = ?, cta = ?,
       headline_main = ?, headline_accent = ?, subheadline = ?,
       offer_text = ?, cta_label = ?, layout_index = ?, image_url = ?,
       status = 'generated', edited = 1, last_error = NULL
     WHERE id = ? AND user_id = ? AND status = 'generated'`,
    [
      f.caption, JSON.stringify(f.hashtags), f.cta,
      f.headlineMain, f.headlineAccent, f.subheadline,
      f.offerText, f.ctaButtonLabel, f.layoutIndex, f.imageUrl,
      id, userId
    ]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'generated');
  return result.changes;
}

/**
 * Text-only edit (used for Reels, which have no ad image to redraw).
 * Only the owner's generated Reel can be edited. Returns rows changed.
 */
async function updatePostCaption(id, userId, { caption, hashtags, cta }) {
  await ensureEditedColumn();
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts
     SET caption = ?, hashtags = ?, cta = ?,
         status = 'generated', edited = 1, last_error = NULL
     WHERE id = ? AND user_id = ?
       AND status = 'generated'`,
    [caption || '', JSON.stringify(hashtags || []), cta || '', id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'generated');
  return result.changes;
}

/**
 * Saves an edited Reel. It STAYS a draft (status 'generated') and is marked
 * edited = 1, so the Drafts list can show an "Edited" badge.
 */
async function updateReelContent(id, userId, fields) {
  await ensureEditedColumn();
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts SET
       caption = ?, hashtags = ?, cta = ?,
       headline_main = ?, headline_accent = ?, subheadline = ?,
       offer_text = ?, cta_label = ?, layout_index = ?, video_url = ?,
       edited = 1, last_error = NULL
     WHERE id = ? AND user_id = ? AND content_type = 'reel'
       AND status = 'generated'`,
    [
      fields.caption || '',
      JSON.stringify(fields.hashtags || []),
      fields.cta || '',
      fields.headlineMain || '',
      fields.headlineAccent || '',
      fields.subheadline || '',
      fields.offerText || '',
      fields.ctaButtonLabel || '',
      Number.isInteger(fields.layoutIndex) ? fields.layoutIndex : 0,
      fields.videoUrl,
      id,
      userId
    ]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'generated');
  return result.changes;
}

async function markReadyToPost(id, userId) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts SET status = 'ready_to_post', last_error = NULL
     WHERE id = ? AND user_id = ? AND status = 'generated'`,
    [id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'ready_to_post');
  return result.changes;
}

async function movePostToGenerated(id, userId) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts SET status = 'generated', last_error = NULL
     WHERE id = ? AND user_id = ? AND status = 'ready_to_post'`,
    [id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'generated');
  return result.changes;
}

async function markAsRejected(id) {
  const db = await getDb();
  const result = await db.run('DELETE FROM posts WHERE id = ?', [id]);
  return result.changes;
}

async function markAsFailed(id, errorMessage) {
  const db = await getDb();
  const message = errorMessage || 'Unknown publishing error';
  const result = await db.run(
    `UPDATE posts
     SET last_error = ?, error_message = ?, publish_lock_until = NULL
     WHERE id = ? AND status = 'scheduled'`,
    [message, message, id]
  );
  if (!result.changes) {
    const post = await db.get('SELECT status FROM posts WHERE id = ?', [id]);
    if (!post) {
      const error = new Error('Post not found');
      error.status = 404;
      throw error;
    }
    const error = new Error(`Cannot record a publish failure unless the post is scheduled (current status: ${post.status}).`);
    error.status = 409;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }
  return result.changes;
}

/**
 * Record a failed publish without changing the scheduled workflow status.
 */
async function markAsPosted(id, userId) {
  const db = await getDb();
  const postedAt = new Date().toISOString();
  const result = await db.run(
    `UPDATE posts
     SET status = 'posted',
         posted_at = ?,
         scheduled_at = NULL,
         last_error = NULL,
         error_message = NULL,
         publish_lock_until = NULL
     WHERE id = ? AND status = 'scheduled'
       AND (? IS NULL OR user_id = ?)`,
    [postedAt, id, userId == null ? null : userId, userId == null ? null : userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'posted');
  return result.changes;
}

/**
 * Schedules a post of this user for scheduledAtIso (a UTC ISO string).
 * A ready_to_post item can be scheduled. A draft Reel can be scheduled too,
 * because the Reels page has no separate Ready to Post step.
 */
async function schedulePostAt(id, userId, scheduledAtIso) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts
     SET status = 'scheduled', scheduled_at = ?,
         last_error = NULL, error_message = NULL, last_schedule_error = NULL,
         schedule_attempts = 0, publish_lock_until = NULL
     WHERE id = ? AND user_id = ?
       AND status IN ('generated', 'ready_to_post')`,
    [scheduledAtIso, id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'scheduled');
  return result.changes;
}

async function reschedulePostAt(id, userId, scheduledAtIso) {
  const scheduledAt = new Date(scheduledAtIso);
  if (!scheduledAtIso || Number.isNaN(scheduledAt.getTime())) {
    const error = new Error('Provide a valid scheduled date and time.');
    error.status = 400;
    throw error;
  }
  if (scheduledAt.getTime() <= Date.now()) {
    const error = new Error('Choose a future date and time to reschedule.');
    error.status = 400;
    throw error;
  }

  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.run(
    `UPDATE posts
     SET scheduled_at = ?,
         schedule_attempts = 0,
         last_error = NULL, error_message = NULL, last_schedule_error = NULL
     WHERE id = ? AND user_id = ? AND status = 'scheduled'
       AND (publish_lock_until IS NULL OR publish_lock_until <= ?)`,
    [scheduledAt.toISOString(), id, userId, now]
  );
  if (!result.changes) {
    const post = await db.get('SELECT status, publish_lock_until FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
    if (!post) {
      const error = new Error('Post not found.');
      error.status = 404;
      throw error;
    }
    if (post.status !== 'scheduled') {
      const error = new Error(`Only scheduled posts can be rescheduled (current status: ${post.status}).`);
      error.status = 409;
      error.code = 'INVALID_STATUS_TRANSITION';
      throw error;
    }
    if (post.publish_lock_until && post.publish_lock_until <= now) {
      const error = new Error('This post could not be rescheduled. Please try again.');
      error.status = 409;
      error.code = 'RESCHEDULE_CONFLICT';
      throw error;
    }
    const error = new Error('This post is already being published and cannot be rescheduled.');
    error.status = 409;
    error.code = 'POST_PUBLISH_IN_PROGRESS';
    throw error;
  }
  return result.changes;
}

/** Cancels a schedule: the post returns to drafts. */
async function unschedulePost(id, userId) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts
     SET status = 'generated',
         scheduled_at = NULL,
         last_error = NULL, error_message = NULL, last_schedule_error = NULL,
         schedule_attempts = 0, publish_lock_until = NULL
     WHERE id = ? AND user_id = ? AND status = 'scheduled'`,
    [id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'generated');
  return result.changes;
}

/** Re-queues a scheduled item after an error without changing its status. */
async function requeueFailedPost(id, userId) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts
     SET scheduled_at = ?, schedule_attempts = 0,
         last_error = NULL, error_message = NULL, last_schedule_error = NULL,
         publish_lock_until = NULL
     WHERE id = ? AND user_id = ? AND status = 'scheduled'`,
    [new Date(Date.now() + 60 * 1000).toISOString(), id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'scheduled');
  return result.changes;
}

/**
 * Reserves a draft for posting right now. The post becomes 'scheduled'
 * with a publish lock, so the background scheduler cannot pick it up and post
 * it a second time while this request is publishing it.
 */
async function markPublishingNow(id, userId) {
  await ensureEditedColumn();
  const db = await getDb();
  const now = new Date();
  const result = await db.run(
    `UPDATE posts
     SET status = 'scheduled', scheduled_at = ?, publish_lock_until = ?,
         last_error = NULL, error_message = NULL, last_schedule_error = NULL,
         schedule_attempts = 0
     WHERE id = ? AND user_id = ?
       AND status IN ('generated', 'ready_to_post')`,
    [now.toISOString(), new Date(now.getTime() + 15 * 60 * 1000).toISOString(), id, userId]
  );
  if (!result.changes) await invalidTransitionForPost(id, userId, 'scheduled');
  return result.changes;
}

/** A post-now attempt failed: the post goes back to drafts with the error. */
async function revertToDraft(id, userId, errorMessage) {
  const db = await getDb();
  const message = errorMessage || 'Unknown publishing error';
  const result = await db.run(
    `UPDATE posts
     SET status = 'generated', scheduled_at = NULL, publish_lock_until = NULL,
         last_error = ?, error_message = ?
     WHERE id = ? AND user_id = ? AND status = 'scheduled'`,
    [message, message, id, userId]
  );
  return result.changes;
}

async function claimDueScheduledPosts(limit = 20) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT id FROM posts
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= ?
     ORDER BY scheduled_at ASC
     LIMIT ?`,
    [new Date().toISOString(), limit]
  );
  const claimed = [];
  for (const { id } of rows) {
    const now = new Date().toISOString();
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const result = await db.run(
      `UPDATE posts SET publish_lock_until = ?
       WHERE id = ? AND status = 'scheduled'
         AND (publish_lock_until IS NULL OR publish_lock_until <= ?)`,
      [lockUntil, id, now]
    );
    if (result.changes === 1) claimed.push(await db.get('SELECT * FROM posts WHERE id = ?', [id]));
  }
  return claimed;
}

async function failStuckPublishingPosts() {
  const db = await getDb();
  const result = await db.run(
    `UPDATE posts
     SET status = CASE WHEN scheduled_at IS NULL THEN 'generated' ELSE 'scheduled' END,
         last_error = 'The server stopped while this post was being published. Check Instagram before retrying.',
         error_message = 'The server stopped while this post was being published. Check Instagram before retrying.',
         publish_lock_until = NULL
     WHERE status = 'publishing'`
  );
  return result.changes;
}

async function getDueScheduledPosts() {
  const db = await getDb();
  const now = new Date().toISOString();
  return db.all(
    `SELECT * FROM posts
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= ?
     ORDER BY scheduled_at ASC`,
    [now]
  );
}

// Deletes one post owned by this user. Returns the number of rows removed.
async function deletePost(id, userId) {
  const db = await getDb();
  const result = await db.run(
    'DELETE FROM posts WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.changes;
}

async function isVideoAssetReferenced(postId, videoUrl, videoSourceUrl) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id FROM posts
     WHERE id != ?
       AND (
         (? IS NOT NULL AND video_url = ?)
         OR (? IS NOT NULL AND video_source_url = ?)
       )
     LIMIT 1`,
    [postId, videoUrl || null, videoUrl || null, videoSourceUrl || null, videoSourceUrl || null]
  );
  return !!row;
}

module.exports = {
  createPost,
  getAllPosts,
  getPostById,
  getRecentReelCopy,
  updatePostContent,
  updatePostCaption,
  updateReelContent,
  markReadyToPost,
  markPublishingNow,
  revertToDraft,
  ensureEditedColumn,
  movePostToGenerated,
  markAsPosted,
  markAsFailed,
  schedulePostAt,
  reschedulePostAt,
  unschedulePost,
  requeueFailedPost,
  claimDueScheduledPosts,
  failStuckPublishingPosts,
  getDueScheduledPosts,
  hasPendingThemedPost,
  hasPendingDraft,
  countPostedPosts,
  deletePost,
  isVideoAssetReferenced
};