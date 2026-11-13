const { getDb } = require('./connection');

async function ensureColumn(db, columns, name, definition) {
  if (columns.has(name)) return;
  let added = false;
  try {
    await db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
    added = true;
  } catch (error) {
    if (!/duplicate column/i.test(String(error.message))) throw error;
  }
  columns.add(name);
  if (added) console.log('[workflow] added posts column:', name);
}

async function ensureContentWorkflowSchema() {
  const db = await getDb();
  const columns = new Set((await db.all('PRAGMA table_info(posts)')).map(column => column.name));

  await ensureColumn(db, columns, 'posted_at', 'TEXT');
  await ensureColumn(db, columns, 'last_error', 'TEXT');
  await ensureColumn(db, columns, 'content_type', "TEXT DEFAULT 'image'");
  await ensureColumn(db, columns, 'publish_lock_until', 'TEXT');
  await ensureColumn(db, columns, 'last_schedule_error', 'TEXT');
  await ensureColumn(db, columns, 'schedule_attempts', 'INTEGER DEFAULT 0');
  await ensureColumn(db, columns, 'scheduled_at', 'TEXT');
  await ensureColumn(db, columns, 'error_message', 'TEXT');

  await db.run(
    `UPDATE posts
     SET last_error = COALESCE(
       NULLIF(last_error, ''),
       NULLIF(last_schedule_error, ''),
       NULLIF(error_message, '')
     )
     WHERE last_error IS NULL OR last_error = ''`
  );

  await db.run(
    `UPDATE posts
     SET status = CASE
       WHEN status IS NULL OR status = 'draft' THEN 'generated'
       WHEN status = 'approved' THEN 'ready_to_post'
       WHEN status = 'published' THEN 'posted'
       WHEN status = 'rejected' THEN 'generated'
       WHEN status IN ('failed', 'publishing') AND scheduled_at IS NOT NULL THEN 'scheduled'
       WHEN status IN ('failed', 'publishing') THEN 'ready_to_post'
       ELSE status
     END
     WHERE status IS NULL
        OR status IN ('draft', 'approved', 'published', 'rejected', 'failed', 'publishing')`
  );

  await db.run(
    `UPDATE posts
     SET posted_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
     WHERE status = 'posted' AND posted_at IS NULL AND created_at IS NOT NULL`
  );

  await db.run(
    `UPDATE posts
     SET content_type = CASE
       WHEN media_type = 'reel' OR video_url IS NOT NULL THEN 'reel'
       ELSE 'image'
     END
     WHERE content_type IS NULL
        OR content_type NOT IN ('image', 'reel')
        OR (content_type != 'reel' AND (media_type = 'reel' OR video_url IS NOT NULL))`
  );
}

module.exports = { ensureContentWorkflowSchema };
