const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  const rows = await db.all(
    'SELECT id, status, posted_at, image_url FROM posts ORDER BY id DESC LIMIT 5'
  );
  console.log(rows);
  process.exit(0);
})();