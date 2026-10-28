const fs = require('fs');
const path = require('path');
const { getDb } = require('./db/connection');

const folder = process.argv[2];
const userId = Number(process.argv[3] || 3);

if (!folder) {
  console.log('Usage: node import-library.js "<folder>" <userId>');
  process.exit(1);
}

(async () => {
  const db = await getDb();
  const files = fs.readdirSync(folder).filter(f => /\.(jpe?g|png)$/i.test(f));

  for (const f of files) {
    const data = fs.readFileSync(path.join(folder, f));
    const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
    await db.run(
      'INSERT INTO image_library (user_id, title, image_url, mime_type, data) VALUES (?, ?, ?, ?, ?)',
      [userId, path.parse(f).name, '', mime, data]
    );
  }

  console.log('Imported', files.length, 'photo(s) for user', userId);
  process.exit(0);
})().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});