require('dotenv').config();
const { getDb } = require('../db/connection');

(async () => {
  const db = await getDb();

  const all = async (sql, params = []) => {
    if (typeof db.all === 'function') return db.all(sql, params);
    if (typeof db.prepare === 'function') return db.prepare(sql).all(...params);
    throw new Error('No all() on db');
  };

  const drafts = await all(
    `SELECT id, campaign_id, user_id, status FROM posts WHERE status = 'draft' ORDER BY campaign_id`
  );
  console.log('Drafts:');
  console.table(drafts);

  const mapping = await all(
    `SELECT c.id AS campaign_id, c.product_name, c.user_id, u.email
     FROM campaigns c LEFT JOIN users u ON u.id = c.user_id`
  );
  console.log('\nCampaign → user email:');
  console.table(mapping);

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});