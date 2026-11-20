const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();

  await db.run(`CREATE TABLE IF NOT EXISTS youtube_accounts (
    user_id INTEGER PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER
  )`);

  const cols = await db.all('PRAGMA table_info(posts)');
  if (!cols.some(function (c) { return c.name === 'youtube_video_id'; })) {
    await db.run('ALTER TABLE posts ADD COLUMN youtube_video_id TEXT');
  }

  console.log('YouTube tables ready');
  process.exit(0);
})().catch(function (err) {
  console.error('Setup failed:', err.message);
  process.exit(1);
});