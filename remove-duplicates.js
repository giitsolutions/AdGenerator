const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();
  const result = await db.run('DELETE FROM image_library WHERE id IN (4, 5, 6)');
  console.log('Removed', result.changes, 'duplicate photo(s)');
  process.exit(0);
})();