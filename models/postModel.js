const { getDb } = require('../db/connection');

async function createPost({
  userId, campaignId, themeId, caption, hashtags, cta, imageUrl,
  headlineMain, headlineAccent, subheadline, offerText, ctaLabel,
  photoKeywords, backgroundFile, layoutIndex
}) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO posts (
       user_id, campaign_id, theme_id, caption, hashtags, cta, image_url,
       headline_main, headline_accent, subheadline, offer_text, cta_label,
       photo_keywords, background_file, layout_index, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      userId, campaignId, themeId || null, caption, JSON.stringify(hashtags), cta, imageUrl || null,
      headlineMain || null, headlineAccent || null, subheadline || null, offerText || null, ctaLabel || null,
      photoKeywords || null, backgroundFile || null, Number.isInteger(layoutIndex) ? layoutIndex : null
    ]
  );
  return result.lastID;
}

/**
 * True if this campaign has a themed post still waiting on a
 * decision (not yet approved or rejected). Used by the daily
 * scheduler to avoid pulling the next theme while a previous one is
 * still pending in the user's inbox.
 */
async function hasPendingThemedPost(campaignId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT id FROM posts WHERE campaign_id = ? AND theme_id IS NOT NULL AND status = 'draft' LIMIT 1`,
    [campaignId]
  );
  return !!row;
}

/**
 * How many posts have actually been published for this campaign.
 * Used to pick the ad layout: it only changes after a post goes live,
 * so rejected / regenerated drafts keep the same layout.
 */
async function countPostedPosts(campaignId) {
  const db = await getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS total FROM posts WHERE campaign_id = ? AND status = 'posted'`,
    [campaignId]
  );
  return row ? row.total : 0;
}

async function getAllPosts(userId) {
  const db = await getDb();
  return db.all('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function getPostById(id, userId) {
  const db = await getDb();
  return db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
}

/** Saves the edited text + the re-drawn image of a draft. */
async function updatePostContent(id, f) {
  const db = await getDb();
  await db.run(
    `UPDATE posts SET
       caption = ?, hashtags = ?, cta = ?,
       headline_main = ?, headline_accent = ?, subheadline = ?,
       offer_text = ?, cta_label = ?, layout_index = ?, image_url = ?
     WHERE id = ?`,
    [
      f.caption, JSON.stringify(f.hashtags), f.cta,
      f.headlineMain, f.headlineAccent, f.subheadline,
      f.offerText, f.ctaButtonLabel, f.layoutIndex, f.imageUrl,
      id
    ]
  );
}

async function markAsPosted(id) {
  const db = await getDb();
  await db.run(`UPDATE posts SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
}

async function markAsRejected(id) {
  const db = await getDb();
  await db.run(`UPDATE posts SET status = 'rejected' WHERE id = ?`, [id]);
}

module.exports = {
  createPost,
  getAllPosts,
  getPostById,
  updatePostContent,
  markAsPosted,
  markAsRejected,
  hasPendingThemedPost,
  countPostedPosts
};