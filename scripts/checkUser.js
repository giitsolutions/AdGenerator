require('dotenv').config();
const { getDb } = require('../db/connection');
(async () => {
  const db = await getDb();
  const id = process.argv[2] || 3;
  let row;
  if (typeof db.get === 'function') {
    row = await db.get('SELECT id, email FROM users WHERE id = ?', [id]);
  } else {
    row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id);
  }
  console.log(row);
  process.exit(0);
})();
