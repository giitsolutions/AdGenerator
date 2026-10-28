const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  const rows = await db.all(
    'SELECT id, title, user_id, length(data) AS bytes FROM image_library WHERE data IS NOT NULL'
  );
  console.log(rows);
  process.exit(0);
})();