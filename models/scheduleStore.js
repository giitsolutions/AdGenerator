const { getDb } = require('../db/connection');

let columnsReady = false;

async function ensureColumns() {
  if (columnsReady) return;
  const db = await getDb();

  const add = async (sql) => {
    try {
      if (typeof db.exec === 'function') {
        // sqlite package — exec returns a Promise, must await
        await db.exec(sql);
      } else if (typeof db.run === 'function') {
        await db.run(sql);
      }
    } catch (e) {
      // column already exists — ignore
      if (!/duplicate column|already exists/i.test(String(e && e.message))) {
        console.warn('[scheduleStore] column note:', e.message);
      }
    }
  };

  await add(`ALTER TABLE posts ADD COLUMN scheduled_at TEXT`);
  await add(`ALTER TABLE posts ADD COLUMN schedule_attempts INTEGER DEFAULT 0`);
  await add(`ALTER TABLE posts ADD COLUMN last_schedule_error TEXT`);

  columnsReady = true;
  console.log('[scheduleStore] scheduled_at columns ready');
}

async function markAsScheduled(postId, userId, scheduledAtIso) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET status = 'scheduled',
        scheduled_at = ?,
        schedule_attempts = 0,
        last_schedule_error = NULL
    WHERE id = ? AND user_id = ?
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    await stmt.run(scheduledAtIso, postId, userId);
    if (stmt.finalize) await stmt.finalize();
  } else {
    await db.run(sql, [scheduledAtIso, postId, userId]);
  }
}

async function markAsUnscheduled(postId, userId) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET status = 'draft',
        scheduled_at = NULL,
        schedule_attempts = 0,
        last_schedule_error = NULL
    WHERE id = ? AND user_id = ? AND status IN ('scheduled', 'publishing')
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    await stmt.run(postId, userId);
    if (stmt.finalize) await stmt.finalize();
  } else {
    await db.run(sql, [postId, userId]);
  }
}

async function markPublishing(postId) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET status = 'publishing'
    WHERE id = ? AND status = 'scheduled'
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    const result = await stmt.run(postId);
    if (stmt.finalize) await stmt.finalize();
    return result.changes ?? 0;
  }
  const result = await db.run(sql, [postId]);
  return result.changes ?? result.affectedRows ?? 0;
}

async function recordAttempt(postId, errorMessage) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET schedule_attempts = COALESCE(schedule_attempts, 0) + 1,
        last_schedule_error = ?,
        status = 'scheduled'
    WHERE id = ?
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    await stmt.run(errorMessage || 'unknown', postId);
    if (stmt.finalize) await stmt.finalize();
  } else {
    await db.run(sql, [errorMessage || 'unknown', postId]);
  }
}

async function markFailed(postId, errorMessage) {
  await ensureColumns();
  const db = await getDb();
  const sql = `
    UPDATE posts
    SET status = 'failed',
        last_schedule_error = ?
    WHERE id = ?
  `;
  if (typeof db.prepare === 'function') {
    const stmt = await db.prepare(sql);
    await stmt.run(errorMessage || 'max retries', postId);
    if (stmt.finalize) await stmt.finalize();
  } else {
    await db.run(sql, [errorMessage || 'max retries', postId]);
  }
}

async function getDueScheduledPosts({ maxLateMs = 6 * 60 * 60 * 1000, maxAttempts = 3 } = {}) {
  await ensureColumns();
  const db = await getDb();
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - maxLateMs).toISOString();

  const sql = `
    SELECT *
    FROM posts
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
      AND scheduled_at >= ?
      AND COALESCE(schedule_attempts, 0) < ?
    ORDER BY scheduled_at ASC
  `;

  if (typeof db.prepare === 'function') {
    return db.all(sql, [now, earliest, maxAttempts]);
  }
  return db.all(sql, [now, earliest, maxAttempts]);
}

async function getExpiredScheduledPosts({ maxLateMs = 6 * 60 * 60 * 1000 } = {}) {
  await ensureColumns();
  const db = await getDb();
  const cutoff = new Date(Date.now() - maxLateMs).toISOString();

  const sql = `
    SELECT id, scheduled_at
    FROM posts
    WHERE status = 'scheduled'
      AND scheduled_at IS NOT NULL
      AND scheduled_at < ?
  `;

  if (typeof db.prepare === 'function') {
    return db.all(sql, [cutoff]);
  }
  return db.all(sql, [cutoff]);
}

async function getPostForUser(postId, userId) {
  const db = await getDb();
  const sql = `SELECT * FROM posts WHERE id = ? AND user_id = ?`;
  if (typeof db.get === 'function') {
    return db.get(sql, [postId, userId]);
  }
  return db.get(sql, [postId, userId]);
}

module.exports = {
  ensureColumns,
  markAsScheduled,
  markAsUnscheduled,
  markPublishing,
  recordAttempt,
  markFailed,
  getDueScheduledPosts,
  getExpiredScheduledPosts,
  getPostForUser
};