// add-scheduled-at.js
// Run once: node add-scheduled-at.js

const { getDb } = require('./db/connection');

(async () => {
  const db = await getDb();

  const add = async (sql) => {
    try {
      if (typeof db.exec === 'function') {
        db.exec(sql); // better-sqlite3
      } else {
        await db.run(sql); // sqlite3
      }
      console.log('OK:', sql.slice(0, 50) + '...');
    } catch (e) {
      if (/duplicate column|already exists/i.test(e.message)) {
        console.log('Already exists — skipped');
      } else {
        console.error('Error:', e.message);
      }
    }
  };

  await add(`ALTER TABLE posts ADD COLUMN scheduled_at TEXT`);
  await add(`ALTER TABLE posts ADD COLUMN schedule_attempts INTEGER DEFAULT 0`);
  await add(`ALTER TABLE posts ADD COLUMN last_schedule_error TEXT`);

  console.log('Done. Restart the server.');
  process.exit(0);
})();