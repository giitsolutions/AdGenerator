const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

let dbPromise = null;

// Every caller shares ONE open + migration run. Two parallel first calls (for
// example the scheduler's startup check and the first web request) used to
// each run the ALTER TABLEs, which can fail with "duplicate column name".
function getDb() {
  if (!dbPromise) {
    dbPromise = initDb().catch(err => {
      dbPromise = null; // let the next call try again
      throw err;
    });
  }
  return dbPromise;
}

async function initDb() {
  // Set DB_PATH in .env to keep the database in a fixed place outside the
  // project folder (e.g. DB_PATH=C:\\kwikpost-data\\app.db), so replacing,
  // re-cloning or syncing the project can never wipe your data.
  const dbFile = process.env.DB_PATH || path.join(__dirname, 'app.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  console.log('[db] Using database file:', dbFile);

  const dbInstance = await open({
    filename: dbFile,
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

  // Columns added to campaigns after the first version — add them to older
  // databases if missing (claim email / WhatsApp shown on the ad).
  const campaignColumns = await dbInstance.all(`PRAGMA table_info(campaigns)`);
  for (const [name, type] of [['contact_email', 'TEXT'], ['whatsapp_number', 'TEXT']]) {
    if (!campaignColumns.some(col => col.name === name)) {
      await dbInstance.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${type}`);
    }
  }

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
      status TEXT DEFAULT 'generated',
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

  // Columns that let a draft be edited after it is generated: the text
  // that is drawn on the image, plus the saved background photo, so the
  // text can be changed and re-drawn without generating a new image.
  const editColumns = [
    ['headline_main', 'TEXT'],
    ['headline_accent', 'TEXT'],
    ['subheadline', 'TEXT'],
    ['offer_text', 'TEXT'],
    ['cta_label', 'TEXT'],
    ['photo_keywords', 'TEXT'],
    ['background_file', 'TEXT'],
    ['layout_index', 'INTEGER']
  ];
  for (const [name, type] of editColumns) {
    if (!postsColumns.some(col => col.name === name)) {
      await dbInstance.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
    }
  }

  // Columns used by scheduled / failed posts (see models/postModel.js:
  // markAsPosted, markAsFailed, markAsScheduled, getDueScheduledPosts).
  // Without them, approving a post fails AFTER it was already sent to Instagram.
  for (const [name, type] of [['scheduled_at', 'TEXT'], ['error_message', 'TEXT']]) {
    if (!postsColumns.some(col => col.name === name)) {
      await dbInstance.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
    }
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
      // Remembers every stock photo already used, so the same photo is
  // never picked twice (see services/providers/*).
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS used_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      used_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, photo_id)
    );
  `);
  // image_library = photos a user uploads once and reuses as post
  // backgrounds. The image bytes live in the database (data BLOB), so
  // nothing depends on an external image host. `slug` is a random key
  // used for public preview links.
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS image_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      image_url TEXT DEFAULT '',
      mime_type TEXT,
      data BLOB,
      slug TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  // Older copies of this table may lack some columns — add them if missing.
  const libColumns = await dbInstance.all(`PRAGMA table_info(image_library)`);
  for (const [name, type] of [['image_url', "TEXT DEFAULT ''"], ['mime_type', 'TEXT'], ['data', 'BLOB'], ['slug', 'TEXT']]) {
    if (!libColumns.some(col => col.name === name)) {
      await dbInstance.exec(`ALTER TABLE image_library ADD COLUMN ${name} ${type}`);
    }
  }

  return dbInstance;
}

module.exports = { getDb };