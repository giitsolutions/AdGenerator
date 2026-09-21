const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: path.join(__dirname, 'app.db'),
    driver: sqlite3.Database
  });

  // users = each person who signs up. Instagram connection fields are
  // filled in when the user clicks "Connect Instagram" and completes
  // Facebook's login flow directly on our site — no external account
  // (Make.com, developer portal, etc.) required from the user.
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      instagram_access_token TEXT,
      instagram_business_account_id TEXT,
      instagram_page_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      audience TEXT,
      tone TEXT,
      offer_details TEXT,
      interval_cron TEXT DEFAULT '0 */6 * * *',
      auto_approve INTEGER DEFAULT 0,
      default_image_url TEXT,
      website TEXT,
      logo_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      theme_id INTEGER,
      caption TEXT,
      hashtags TEXT,
      cta TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      posted_at TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (theme_id) REFERENCES themes(id)
    );
  `);
  // Older databases created before theme_id existed won't have the
  // column — add it if missing, so this keeps working without a
  // manual migration step.
  const postsColumns = await dbInstance.all(`PRAGMA table_info(posts)`);
  if (!postsColumns.some(col => col.name === 'theme_id')) {
    await dbInstance.exec(`ALTER TABLE posts ADD COLUMN theme_id INTEGER REFERENCES themes(id)`);
  }

  // themes = a pre-loaded queue of daily content ideas per campaign.
  // The daily scheduler picks the lowest-position UNUSED theme each
  // day, generates a post around it, and marks it used — so a user
  // can load 20 themes once and not touch the app again for 20 days.
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      theme_text TEXT NOT NULL,
      position INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  return dbInstance;
}

module.exports = { getDb };
