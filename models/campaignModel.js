const { getDb } = require('../db/connection');

async function createCampaign({
  userId,
  productName,
  audience,
  tone,
  offerDetails,
  intervalCron,
  autoApprove,
  defaultImageUrl,
  website,
  logoUrl,
  contactEmail,
  whatsappNumber
}) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO campaigns (
       user_id, product_name, audience, tone, offer_details,
       interval_cron, auto_approve, default_image_url, website, logo_url,
       contact_email, whatsapp_number
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      productName,
      audience || null,
      tone || null,
      offerDetails || null,
      intervalCron || '0 */6 * * *',
      autoApprove ? 1 : 0,
      defaultImageUrl || null,
      website || null,
      logoUrl || null,
      contactEmail || null,
      whatsappNumber || null
    ]
  );
  return result.lastID;
}

async function getAllCampaigns(userId) {
  const db = await getDb();
  return db.all(
    'SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

async function getCampaignById(id, userId) {
  const db = await getDb();
  return db.get(
    'SELECT * FROM campaigns WHERE id = ? AND user_id = ?',
    [id, userId]
  );
}

async function getAllCampaignsAcrossAllUsers() {
  const db = await getDb();
  return db.all('SELECT * FROM campaigns ORDER BY created_at DESC');
}

/**
 * Writes the full set of editable fields.
 * The controller merges request values with existing ones before calling this,
 * so empty values here mean the user actually cleared the field.
 */
async function updateCampaign(id, userId, data) {
  const db = await getDb();
  const result = await db.run(
    `UPDATE campaigns
     SET product_name = ?,
         audience = ?,
         tone = ?,
         offer_details = ?,
         website = ?,
         logo_url = ?,
         contact_email = ?,
         whatsapp_number = ?
     WHERE id = ? AND user_id = ?`,
    [
      data.productName,
      data.audience || null,
      data.tone || null,
      data.offerDetails || null,
      data.website || null,
      data.logoUrl || null,
      data.contactEmail || null,
      data.whatsappNumber || null,
      id,
      userId
    ]
  );
  return result.changes;
}

async function deleteCampaign(id, userId) {
  const db = await getDb();
  const result = await db.run(
    'DELETE FROM campaigns WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.changes;
}

module.exports = {
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getAllCampaignsAcrossAllUsers,
  updateCampaign,
  deleteCampaign
};