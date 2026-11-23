const { getDb } = require('./db/connection');
(async () => {
  const db = await getDb();
  const cols = await db.all('PRAGMA table_info(posts)');
  const names = cols.map(c => c.name).filter(n => /insta|media|ig_|published|posted/i.test(n));
  console.log('columns:', names);
  const row = await db.get('SELECT * FROM posts WHERE id = 411');
  const pick = {};
  names.forEach(n => pick[n] = row[n]);
  pick.status = row.status;
  pick.posted_at = row.posted_at;
  pick.last_error = row.last_error;
  console.log(pick);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });