const bcrypt = require('bcrypt');
const { getDb } = require('../db/connection');

// TEMPORARY (login disabled for now — see middleware/authMiddleware.js):
// everything runs as this one auto-created account instead of requiring
// signup/login. Re-enabling login later just means reverting the
// middleware; this row and all data tied to it stay intact either way.
const DEFAULT_USER_EMAIL = 'local@localhost';

async function getOrCreateDefaultUser() {
  const db = await getDb();
  let user = await db.get('SELECT * FROM users WHERE email = ?', [DEFAULT_USER_EMAIL]);
  if (!user) {
    const passwordHash = await bcrypt.hash(Math.random().toString(36), 10); // unused placeholder, login is bypassed
    const result = await db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [DEFAULT_USER_EMAIL, passwordHash]
    );
    user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
  }
  return user;
}

async function createUser({ email, passwordHash }) {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO users (email, password_hash) VALUES (?, ?)`,
    [email, passwordHash]
  );
  return result.lastID;
}

async function getUserByEmail(email) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE email = ?', [email]);
}

async function getUserById(id) {
  const db = await getDb();
  return db.get(
    `SELECT id, email, instagram_business_account_id, instagram_page_name, created_at
     FROM users WHERE id = ?`,
    [id]
  );
}

// Full row including the access token — only used internally when
// actually publishing a post, never sent to the frontend.
async function getUserWithInstagramToken(id) {
  const db = await getDb();
  return db.get(
    'SELECT id, instagram_access_token, instagram_business_account_id FROM users WHERE id = ?',
    [id]
  );
}

async function saveInstagramConnection(userId, { accessToken, businessAccountId, pageName }) {
  const db = await getDb();
  await db.run(
    `UPDATE users
     SET instagram_access_token = ?, instagram_business_account_id = ?, instagram_page_name = ?
     WHERE id = ?`,
    [accessToken, businessAccountId, pageName, userId]
  );
}

async function disconnectInstagram(userId) {
  const db = await getDb();
  await db.run(
    `UPDATE users
     SET instagram_access_token = NULL, instagram_business_account_id = NULL, instagram_page_name = NULL
     WHERE id = ?`,
    [userId]
  );
}

module.exports = {
  getOrCreateDefaultUser,
  createUser,
  getUserByEmail,
  getUserById,
  getUserWithInstagramToken,
  saveInstagramConnection,
  disconnectInstagram
};
