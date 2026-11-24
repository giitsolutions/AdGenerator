const { getDb } = require('../db/connection');

let columnsReady = false;
const EXPIRED_SCHEDULE_ERROR = 'Scheduled time more than 6 hours ago';

async function ensureColumns() {
  if (columnsReady) return;
  const db = await getDb();
  const columns = new Set((await db.all('PRAGMA table_info(posts)')).map(column => column.name));
  for (const [name, definition] of [
    ['scheduled_at', 'TEXT'],
    ['schedule_attempts', 'INTEGER DEFAULT 0'],
    ['last_schedule_error', 'TEXT'],
    ['publish_lock_until', 'TEXT'],
    ['last_error', 'TEXT'],
    ['error_message', 'TEXT'],
    ['story_scheduled', 'INTEGER DEFAULT 0'],    // 1 = also post an Instagram Story when this post publishes
    ['facebook_scheduled', 'INTEGER DEFAULT 0']  // 1 = also post to the Facebook Page when this post publishes
  ]) {
    if (columns.has(name)) continue;
    await db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    columns.add(name);
  }

  columnsReady = true;
  console.log('[scheduleStore] scheduled_at columns ready');
}

// Set a post's scheduled time and clear any previous attempt information.
async function markAsScheduled(postId, userId, scheduledAtIso) {
  await ensureColumns();
  return require('./postModel').schedulePostAt(postId, userId, scheduledAtIso);
}

async function reschedulePost(postId, userId, scheduledAtIso) {
  await ensureColumns();
  return require('./postModel').reschedulePostAt(postId, userId, scheduledAtIso);
}

// Cancelling a schedule returns the post to ready_to_post.
async function markAsUnscheduled(postId, userId) {
  await ensureColumns();
  return require('./postModel').unschedulePost(postId, userId);
}

// Claim a due post without introducing another workflow status.
async function markPublishing(postId, expectedScheduledAt) {
  await ensureColumns();
  const db = await getDb();
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const sql = `
    UPDATE posts
    SET publish_lock_until = ?
    WHERE id = ? AND status = 'scheduled'
      AND scheduled_at <= ?
      AND (? IS NULL OR scheduled_at = ?)
      AND (publish_lock_until IS NULL OR publish_lock_until <= ?)
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    const result = await stmt.run(lockUntil, postId, now, expectedScheduledAt || null, expectedScheduledAt || null, now);
    if (stmt.finalize) await stmt.finalize();
    return result.changes ?? 0;
  }
  const result = await db.run(sql, [lockUntil, postId, now, expectedScheduledAt || null, expectedScheduledAt || null, now]);
  return result.changes ?? result.affectedRows ?? 0;
}

// Record a failed attempt and leave it eligible for a later retry.
async function recordAttempt(postId, errorMessage) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET schedule_attempts = COALESCE(schedule_attempts, 0) + 1,
        last_schedule_error = ?,
        last_error = ?,
        error_message = ?,
        publish_lock_until = NULL
    WHERE id = ? AND status = 'scheduled'
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    const message = errorMessage || 'unknown';
    await stmt.run(message, message, message, postId);
    if (stmt.finalize) await stmt.finalize();
  } else {
    const message = errorMessage || 'unknown';
    await db.run(sql, [message, message, message, postId]);
  }
}

// Record an expired item without changing its scheduled workflow status.
async function markFailed(postId, errorMessage) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET last_schedule_error = ?,
        last_error = ?,
        error_message = ?,
        publish_lock_until = NULL
    WHERE id = ? AND status = 'scheduled'
      AND COALESCE(last_schedule_error, '') <> ?
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    const message = errorMessage || 'Publishing error';
    const result = await stmt.run(message, message, message, postId, message);
    if (stmt.finalize) await stmt.finalize();
    return result.changes ?? 0;
  } else {
    const message = errorMessage || 'Publishing error';
    const result = await db.run(sql, [message, message, message, postId, message]);
    return result.changes ?? result.affectedRows ?? 0;
  }
}

// Posts eligible for the next scheduler attempt.
async function getDueScheduledPosts({ maxLateMs = 6 * 60 * 60 * 1000, maxAttempts = 3 } = {}) {
  await ensureColumns();
  const db = await getDb();
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - maxLateMs).toISOString();

  const sql = `
    SELECT *
    FROM posts
    WHERE status = 'scheduled'
      AND (schedule_platform IS NULL OR schedule_platform != 'youtube')
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
      AND scheduled_at >= ?
      AND COALESCE(schedule_attempts, 0) < ?
      AND (publish_lock_until IS NULL OR publish_lock_until <= ?)
    ORDER BY scheduled_at ASC
  `;

  if (typeof db.prepare === 'function') {
    return db.all(sql, [now, earliest, maxAttempts, now]);
  }
  return db.all(sql, [now, earliest, maxAttempts, now]);
}

// Posts that exceeded the maximum allowed lateness.
async function getExpiredScheduledPosts({ maxLateMs = 6 * 60 * 60 * 1000 } = {}) {
  await ensureColumns();
  const db = await getDb();
  const cutoff = new Date(Date.now() - maxLateMs).toISOString();

  const sql = `
    SELECT id, scheduled_at
    FROM posts
    WHERE status = 'scheduled'
      AND (schedule_platform IS NULL OR schedule_platform != 'youtube')
      AND scheduled_at IS NOT NULL
      AND scheduled_at < ?
      AND (publish_lock_until IS NULL OR publish_lock_until <= ?)
      AND COALESCE(last_schedule_error, '') <> ?
  `;

  if (typeof db.prepare === 'function') {
    return db.all(sql, [cutoff, new Date().toISOString(), EXPIRED_SCHEDULE_ERROR]);
  }
  return db.all(sql, [cutoff, new Date().toISOString(), EXPIRED_SCHEDULE_ERROR]);
}

async function getPostForUser(postId, userId) {
  const db = await getDb();
  const sql = `SELECT * FROM posts WHERE id = ? AND user_id = ?`;
  if (typeof db.get === 'function') {
    return db.get(sql, [postId, userId]);
  }
  return db.get(sql, [postId, userId]);
}

// ---------------------------------------------------------------------
// Follow-up actions that run right after a scheduled post publishes:
// an Instagram Story and a Facebook Page post.
// ---------------------------------------------------------------------

// Remember whether a Story should be posted along with this scheduled post.
async function setStoryFlag(postId, userId, on) {
  await ensureColumns();
  const db = await getDb();
  await db.run(
    'UPDATE posts SET story_scheduled = ? WHERE id = ? AND user_id = ?',
    [on ? 1 : 0, postId, userId]
  );
}

// Remember whether the Facebook Page should get this post too.
async function setFacebookFlag(postId, userId, on) {
  await ensureColumns();
  const db = await getDb();
  await db.run(
    'UPDATE posts SET facebook_scheduled = ? WHERE id = ? AND user_id = ?',
    [on ? 1 : 0, postId, userId]
  );
}

async function clearStoryFlag(postId) {
  await ensureColumns();
  const db = await getDb();
  await db.run('UPDATE posts SET story_scheduled = 0 WHERE id = ?', [postId]);
}

async function clearFacebookFlag(postId) {
  await ensureColumns();
  const db = await getDb();
  await db.run('UPDATE posts SET facebook_scheduled = 0 WHERE id = ?', [postId]);
}

// Atomically claim a follow-up BEFORE sending it. Returns true only for the one
// caller that flipped the flag from 1 to 0, so a crash or a second scheduler
// tick can never send the same Story or Facebook post twice.
async function claimFollowUp(column, postId) {
  await ensureColumns();
  const db = await getDb();
  const result = await db.run(`UPDATE posts SET ${column} = 0 WHERE id = ? AND ${column} = 1`, [postId]);
  return (result.changes ?? result.affectedRows ?? 0) > 0;
}
const claimStory = postId => claimFollowUp('story_scheduled', postId);
const claimFacebook = postId => claimFollowUp('facebook_scheduled', postId);

// Save a follow-up error on a post whose main publish already succeeded.
// Several errors are joined, so a Story error and a Facebook error do not overwrite each other.
async function recordFollowUpError(postId, label, errorMessage) {
  await ensureColumns();
  const db = await getDb();
  const text = `${label}: ${errorMessage || 'failed'}`;
  await db.run(
    `UPDATE posts
     SET last_error = CASE WHEN last_error IS NULL OR last_error = '' THEN ? ELSE last_error || ' | ' || ? END
     WHERE id = ?`,
    [text, text, postId]
  );
}
const recordStoryError = (postId, message) => recordFollowUpError(postId, 'Story failed', message);
const recordFacebookError = (postId, message) => recordFollowUpError(postId, 'Facebook failed', message);

module.exports = {
  ensureColumns,
  markAsScheduled,
  reschedulePost,
  markAsUnscheduled,
  markPublishing,
  recordAttempt,
  markFailed,
  getDueScheduledPosts,
  getExpiredScheduledPosts,
  EXPIRED_SCHEDULE_ERROR,
  getPostForUser,
  setStoryFlag,
  clearStoryFlag,
  claimStory,
  recordStoryError,
  setFacebookFlag,
  clearFacebookFlag,
  claimFacebook,
  recordFacebookError
};