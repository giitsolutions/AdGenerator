const { getDb } = require('../db/connection');

async function createPost({ userId, campaignId, themeId, caption, hashtags, cta, imageUrl }) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO posts (user_id, campaign_id, theme_id, caption, hashtags, cta, image_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [userId, campaignId, themeId || null, caption, JSON.stringify(hashtags), cta, imageUrl || null]
  );
  return result.lastID;
}

async function getAllPosts(userId) {
  const db = await getDb();
  return db.all('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function getPostById(id, userId) {
  const db = await getDb();
  return db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', [id, userId]);
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
  markAsPosted,
  markAsRejected
};
