/**
 * Clear draft posts for testing.
 *   node scripts/clearDrafts.js 1     → campaign 1 only
 *   node scripts/clearDrafts.js       → all drafts
 */
require('dotenv').config();

const { getDb } = require('../db/connection');

(async () => {
  const campaignId = process.argv[2];
  const db = await getDb();

  const run = async (sql, params = []) => {
    // sqlite (async) package
    if (typeof db.run === 'function') {
      return db.run(sql, params);
    }
    // better-sqlite3
    if (typeof db.prepare === 'function') {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes };
    }
    // node-sqlite3 wrapper sometimes exposes exec only
    if (typeof db.exec === 'function' && params.length === 0) {
      await db.exec(sql);
      return { changes: -1 };
    }
    throw new Error('No supported run/prepare on db');
  };

  let result;
  if (campaignId) {
    result = await run(
      `DELETE FROM posts WHERE status = 'draft' AND campaign_id = ?`,
      [campaignId]
    );
    console.log('Deleted drafts for campaign', campaignId, result);
  } else {
    result = await run(`DELETE FROM posts WHERE status = 'draft'`);
    console.log('Deleted ALL drafts', result);
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});