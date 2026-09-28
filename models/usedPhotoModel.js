const { getDb } = require('../db/connection');

async function getUsedIds(provider) {
  const db = await getDb();
  const rows = await db.all('SELECT photo_id FROM used_photos WHERE provider = ?', [provider]);
  return new Set(rows.map(r => r.photo_id));
}

async function markUsed(provider, photoId) {
  const db = await getDb();
  await db.run('INSERT OR IGNORE INTO used_photos (provider, photo_id) VALUES (?, ?)', [provider, String(photoId)]);
}

module.exports = { getUsedIds, markUsed };