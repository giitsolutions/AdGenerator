const { getDb } = require('../db/connection');

async function createCampaign({ userId, productName, audience, tone, offerDetails, intervalCron, autoApprove, defaultImageUrl, website, logoUrl }) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO campaigns (user_id, product_name, audience, tone, offer_details, interval_cron, auto_approve, default_image_url, website, logo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, productName, audience, tone, offerDetails, intervalCron || '0 */6 * * *', autoApprove ? 1 : 0, defaultImageUrl || null, website || null, logoUrl || null]
  );
  return result.lastID;
}

// Every read is scoped to the requesting user's own campaigns only —
// this is what keeps different users' data separate from each other.
async function getAllCampaigns(userId) {
  const db = await getDb();
  return db.all('SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function getCampaignById(id, userId) {
  const db = await getDb();
  return db.get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', [id, userId]);
}

// Used by the scheduler, which runs for all users at once — not
// scoped to a single user, since it processes every active campaign.
async function getAllCampaignsAcrossAllUsers() {
  const db = await getDb();
  return db.all('SELECT * FROM campaigns ORDER BY created_at DESC');
}

module.exports = {
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllCampaignsAcrossAllUsers
};
