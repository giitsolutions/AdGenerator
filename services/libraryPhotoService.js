const crypto = require('crypto');
const { getDb } = require('../db/connection');

// If photoId is given, that exact photo is used (and the rotation does not move).
// Otherwise the next photo in the rotation is used.
async function pickLibraryPhoto(userId, photoId) {
  const db = await getDb();

  if (photoId) {
    const chosen = await db.get(
      'SELECT id, title, data FROM image_library WHERE id = ? AND user_id = ? AND data IS NOT NULL',
      [photoId, userId]
    );
    if (!chosen) throw new Error('The selected photo was not found');
    return { id: chosen.id, title: chosen.title, buffer: chosen.data };
  }

  await db.exec(`CREATE TABLE IF NOT EXISTS library_rotation (
    user_id INTEGER PRIMARY KEY,
    next_index INTEGER NOT NULL DEFAULT 0
  )`);

  const images = await db.all(
    'SELECT id, title, data FROM image_library WHERE user_id = ? AND data IS NOT NULL ORDER BY id ASC',
    [userId]
  );
  if (!images.length) return null;

  const row = await db.get(
    'SELECT next_index FROM library_rotation WHERE user_id = ?',
    [userId]
  );
  const index = row ? row.next_index % images.length : 0;
  const img = images[index];

  await db.run(
    `INSERT INTO library_rotation (user_id, next_index) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET next_index = excluded.next_index`,
    [userId, (index + 1) % images.length]
  );

  return { id: img.id, title: img.title, buffer: img.data };
}

// A unique background file name, saved in storage/backgrounds.
function newBackgroundFile() {
  return `bg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`;
}

module.exports = { pickLibraryPhoto, newBackgroundFile };