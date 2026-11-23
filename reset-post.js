const { getDb } = require('./db/connection');
(async () => {
  const db = await getDb();
  await db.run("UPDATE posts SET status = 'generated' WHERE id = 411");
  console.log('reset');
  process.exit(0);
})().catch(function (err) {
  console.error('Failed:', err.message);
  process.exit(1);
});