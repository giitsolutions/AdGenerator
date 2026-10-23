const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  await db.run("UPDATE posts SET status = 'draft', posted_at = NULL WHERE id = ?", [134]);
  const row = await db.get('SELECT id, status, posted_at FROM posts WHERE id = ?', [134]);
  console.log(row);
  process.exit(0);
})();