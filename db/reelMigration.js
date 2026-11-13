// db/reelMigration.js
const { q } = require('./query');

const REEL_COLUMNS = [
  "media_type TEXT DEFAULT 'image'",
  'video_url TEXT',
  'video_source_url TEXT',
  'video_thumb_url TEXT',
];

async function ensureReelColumns() {
  for (const col of REEL_COLUMNS) {
    try {
      await q().run(`ALTER TABLE posts ADD COLUMN ${col}`);
      console.log('[reels] added column:', col.split(' ')[0]);
    } catch (e) {
      if (!/duplicate column/i.test(String(e.message))) throw e;
    }
  }
  await q().run("UPDATE posts SET media_type = 'image' WHERE media_type IS NULL");
}

module.exports = { ensureReelColumns };