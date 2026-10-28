const { getDb } = require('./db/connection');

const photoId = Number(process.argv[2]);
const userId = Number(process.argv[3] || 3);

if (!photoId) {
  console.log('Usage: node delete-photo.js <photoId> [userId]');
  process.exit(1);
}

(async () => {
  const db = await getDb();
  const r = await db.run(
    'DELETE FROM image_library WHERE id = ? AND user_id = ?',
    [photoId, userId]
  );
  console.log(r.changes ? 'Deleted photo ' + photoId : 'No photo found with id ' + photoId);
  process.exit(0);
})();