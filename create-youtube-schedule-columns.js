const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  const cols = await db.all('PRAGMA table_info(posts)');
  const names = cols.map(function (c) { return c.name; });
  if (!names.includes('schedule_platform')) await db.run('ALTER TABLE posts ADD COLUMN schedule_platform TEXT');
  if (!names.includes('youtube_publish_at')) await db.run('ALTER TABLE posts ADD COLUMN youtube_publish_at TEXT');
  console.log('Schedule columns ready');
  process.exit(0);
})().catch(function (err) {
  console.error('Setup failed:', err.message);
  process.exit(1);
});