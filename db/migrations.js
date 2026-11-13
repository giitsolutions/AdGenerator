// Safe, repeatable migrations (ignore "duplicate column").
const THEME_TABLES = ['themes', 'campaign_themes', 'theme_queue', 'post_themes'];
let themeMetaCache = null;

async function addColumn(q, table, def) {
  try { await q.run(`ALTER TABLE ${table} ADD COLUMN ${def}`); }
  catch (e) { if (!/duplicate column|no such table/i.test(String(e.message))) throw e; }
}

// Finds the theme-queue table and which columns hold "used", the label and the order.
async function findThemeMeta(q, { refresh = false } = {}) {
  if (themeMetaCache && !refresh) return themeMetaCache;
  for (const table of THEME_TABLES) {
    const exists = await q.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
    if (!exists) continue;
    const cols = (await q.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
    if (!cols.includes('campaign_id')) continue;
    const labelCol = ['theme', 'title', 'name', 'text', 'topic', 'idea', 'description'].find((c) => cols.includes(c))
      || cols.find((c) => !['id', 'campaign_id', 'user_id', 'used', 'is_used'].includes(c));
    themeMetaCache = {
      table, labelCol,
      usedCol: ['used', 'is_used'].find((c) => cols.includes(c)) || null,
      orderCol: ['position', 'sort_order', 'order_index'].find((c) => cols.includes(c)) || 'id',
    };
    return themeMetaCache;
  }
  return null;
}

async function ensureSchema(q) {
  await addColumn(q, 'campaigns', 'contact_email TEXT');
  await addColumn(q, 'campaigns', 'whatsapp_number TEXT');
  await addColumn(q, 'posts', 'theme_id INTEGER');
  await q.run(`CREATE TABLE IF NOT EXISTS image_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, filename TEXT, mime_type TEXT,
    data BLOB, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  let meta = await findThemeMeta(q, { refresh: true });
  if (meta && !meta.usedCol) {
    await addColumn(q, meta.table, 'used INTEGER DEFAULT 0');
    meta = await findThemeMeta(q, { refresh: true });
  }
}

module.exports = { ensureSchema, findThemeMeta, addColumn };
