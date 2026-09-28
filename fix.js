const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  const result = await db.run(
    "UPDATE posts SET status = 'rejected' WHERE status = 'draft' AND theme_id IS NOT NULL"
  );
  console.log('Done. Cleared ' + result.changes + ' stuck draft(s). Your campaigns are now unblocked.');
  process.exit(0);
})();