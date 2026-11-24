const { getDb } = require('./db/connection');
(async () => {
  const db = await getDb();
  const cols = await db.all('PRAGMA table_info(users)');
  console.log(cols.map(c => c.name).filter(n => /insta|facebook|page|token/i.test(n)));
  const row = await db.get('SELECT * FROM users WHERE id = 3');
  const safe = {};
  Object.keys(row || {}).forEach(k => { safe[k] = /token|secret|password/i.test(k) ? (row[k] ? 'SET' : null) : row[k]; });
  console.log(safe);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });