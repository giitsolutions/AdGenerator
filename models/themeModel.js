const { getDb } = require('../db/connection');

/** Adds a batch of themes (e.g. 20 at once) to a campaign's queue, in order. */
async function addThemes(campaignId, userId, themeTexts) {
  const db = await getDb();
  const existing = await db.get(
    'SELECT COALESCE(MAX(position), -1) as maxPos FROM themes WHERE campaign_id = ?',
    [campaignId]
  );
  let position = existing.maxPos + 1;

  for (const text of themeTexts) {
    await db.run(
      'INSERT INTO themes (campaign_id, user_id, theme_text, position) VALUES (?, ?, ?, ?)',
      [campaignId, userId, text.trim(), position]
    );
    position++;
  }
}

/** The next theme in line for a campaign, oldest/lowest position first. */
async function getNextUnusedTheme(campaignId) {
  const db = await getDb();
  return db.get(
    'SELECT * FROM themes WHERE campaign_id = ? AND used = 0 ORDER BY position ASC LIMIT 1',
    [campaignId]
  );
}

async function markThemeUsed(themeId) {
  const db = await getDb();
  await db.run('UPDATE themes SET used = 1 WHERE id = ?', [themeId]);
}

async function getThemesForCampaign(campaignId, userId) {
  const db = await getDb();
  return db.all(
    'SELECT * FROM themes WHERE campaign_id = ? AND user_id = ? ORDER BY position ASC',
    [campaignId, userId]
  );
}

async function getRemainingCount(campaignId) {
  const db = await getDb();
  const row = await db.get(
    'SELECT COUNT(*) as count FROM themes WHERE campaign_id = ? AND used = 0',
    [campaignId]
  );
  return row.count;
}

async function getThemeById(id) {
  const db = await getDb();
  return db.get('SELECT * FROM themes WHERE id = ?', [id]);
}

module.exports = {
  addThemes,
  getNextUnusedTheme,
  markThemeUsed,
  getThemesForCampaign,
  getRemainingCount,
  getThemeById
};
