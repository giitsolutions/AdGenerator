const { getDb } = require('./db/connection');
(async () => {
  const db = await getDb();
  const rows = await db.all("SELECT id, status, posted_at, last_error FROM posts ORDER BY id DESC LIMIT 8");
  rows.forEach(r => console.log(r.id, r.status, r.posted_at || '-', '|', r.last_error || 'no error saved'));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });