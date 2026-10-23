const bcrypt = require('bcrypt');
const { getDb } = require('../db/connection');

const DEFAULT_USER_EMAIL = 'local@localhost';

// ====================== USER CREATION & RETRIEVAL ======================

/**
 * Get or create default user for the app
 * Used when login is disabled (temporary dev mode)
 */
async function getOrCreateDefaultUser() {
  try {
    const db = await getDb();
    
    let user = await db.get('SELECT * FROM users WHERE email = ?', [DEFAULT_USER_EMAIL]);
    
    if (user) {
      console.log(`[userModel] Default user already exists: ID ${user.id}`);
      return user;
    }

    // Create new default user
    console.log('[userModel] Creating default user...');
    const passwordHash = await bcrypt.hash(Math.random().toString(36), 10);
    
    const result = await db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [DEFAULT_USER_EMAIL, passwordHash]
    );

    user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    console.log(`[userModel] ✅ Default user created: ID ${user.id}`);
    
    return user;
  } catch (err) {
    console.error('[userModel] Error in getOrCreateDefaultUser:', err.message);
    throw err;
  }
}

/**
 * Create a new user with email and password hash
 */
async function createUser({ email, passwordHash }) {
  try {
    if (!email || !passwordHash) {
      throw new Error('Email and password hash are required');
    }

    const db = await getDb();
    
    // Check if user already exists
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      throw new Error('User with this email already exists');
    }

    console.log(`[userModel] Creating user with email: ${email}`);
    
    const result = await db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash]
    );

    console.log(`[userModel] ✅ User created: ID ${result.lastID}`);
    return result.lastID;
  } catch (err) {
    console.error('[userModel] Error in createUser:', err.message);
    throw err;
  }
}

/**
 * Get user by email address
 */
async function getUserByEmail(email) {
  try {
    if (!email) {
      throw new Error('Email is required');
    }

    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    
    if (user) {
      console.log(`[userModel] Found user by email: ${email} (ID: ${user.id})`);
    } else {
      console.log(`[userModel] No user found with email: ${email}`);
    }

    return user;
  } catch (err) {
    console.error('[userModel] Error in getUserByEmail:', err.message);
    throw err;
  }
}

/**
 * Get user by ID - returns public profile info (no sensitive data)
 */
async function getUserById(id) {
  try {
    if (!id) {
      throw new Error('User ID is required');
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT 
        id, 
        email, 
        instagram_access_token,
        instagram_business_account_id, 
        instagram_page_name, 
        created_at
       FROM users 
       WHERE id = ?`,
      [id]
    );

    if (user) {
      console.log(`[userModel] Found user by ID: ${id}`);
    } else {
      console.log(`[userModel] No user found with ID: ${id}`);
    }

    return user;
  } catch (err) {
    console.error('[userModel] Error in getUserById:', err.message);
    throw err;
  }
}

// ====================== INSTAGRAM CONNECTION ======================

/**
 * Get user with Instagram token (sensitive data - internal use only)
 * Used when publishing posts to Instagram
 */
async function getUserWithInstagramToken(id) {
  try {
    if (!id) {
      throw new Error('User ID is required');
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT 
        id, 
        instagram_access_token, 
        instagram_business_account_id 
       FROM users 
       WHERE id = ?`,
      [id]
    );

    if (!user || !user.instagram_access_token) {
      console.log(`[userModel] User ${id} does not have Instagram connected`);
      return null;
    }

    console.log(`[userModel] Retrieved Instagram token for user ${id}`);
    return user;
  } catch (err) {
    console.error('[userModel] Error in getUserWithInstagramToken:', err.message);
    throw err;
  }
}

/**
 * Check if user has Instagram connected
 */
async function isInstagramConnected(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT instagram_access_token, instagram_business_account_id 
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    const connected = !!user && !!user.instagram_access_token && !!user.instagram_business_account_id;
    console.log(`[userModel] Instagram connection for user ${userId}: ${connected ? '✅ Connected' : '❌ Not connected'}`);

    return connected;
  } catch (err) {
    console.error('[userModel] Error in isInstagramConnected:', err.message);
    throw err;
  }
}

/**
 * Save Instagram connection for user
 */
async function saveInstagramConnection(userId, { accessToken, businessAccountId, pageName }) {
  try {
    if (!userId) throw new Error('User ID is required');
    if (!accessToken) throw new Error('Access token is required');
    if (!businessAccountId) throw new Error('Business account ID is required');

    const db = await getDb();

    console.log(`[userModel] Saving Instagram connection for user ${userId}...`);
    
    const result = await db.run(
      `UPDATE users
       SET instagram_access_token = ?, 
           instagram_business_account_id = ?, 
           instagram_page_name = ?
       WHERE id = ?`,
      [accessToken, businessAccountId, pageName || 'Unknown', userId]
    );

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    console.log(`[userModel] ✅ Instagram connection saved for user ${userId}: ${pageName}`);
  } catch (err) {
    console.error('[userModel] Error in saveInstagramConnection:', err.message);
    throw err;
  }
}

/**
 * Disconnect Instagram account
 */
async function disconnectInstagram(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const db = await getDb();

    console.log(`[userModel] Disconnecting Instagram for user ${userId}...`);
    
    const result = await db.run(
      `UPDATE users
       SET instagram_access_token = NULL, 
           instagram_business_account_id = NULL, 
           instagram_page_name = NULL
       WHERE id = ?`,
      [userId]
    );

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    console.log(`[userModel] ✅ Instagram disconnected for user ${userId}`);
  } catch (err) {
    console.error('[userModel] Error in disconnectInstagram:', err.message);
    throw err;
  }
}

/**
 * Get Instagram connection status for user
 */
async function getInstagramStatus(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT instagram_business_account_id, instagram_page_name 
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const status = {
      connected: !!user.instagram_business_account_id,
      businessAccountId: user.instagram_business_account_id || null,
      pageName: user.instagram_page_name || null
    };

    console.log(`[userModel] Instagram status for user ${userId}:`, status);
    return status;
  } catch (err) {
    console.error('[userModel] Error in getInstagramStatus:', err.message);
    throw err;
  }
}

// ====================== PASSWORD RESET ======================

/**
 * Save password reset token
 */
async function saveResetToken(userId, token, expiresAt) {
  try {
    if (!userId || !token || !expiresAt) {
      throw new Error('User ID, token, and expiration are required');
    }

    const db = await getDb();

    console.log(`[userModel] Saving reset token for user ${userId}`);
    
    await db.run(
      `UPDATE users 
       SET reset_token = ?, reset_token_expires = ? 
       WHERE id = ?`,
      [token, expiresAt.toISOString(), userId]
    );

    console.log(`[userModel] ✅ Reset token saved for user ${userId}`);
  } catch (err) {
    console.error('[userModel] Error in saveResetToken:', err.message);
    throw err;
  }
}

/**
 * Verify password reset token
 */
async function verifyResetToken(userId, token) {
  try {
    if (!userId || !token) {
      throw new Error('User ID and token are required');
    }

    const db = await getDb();
    const user = await db.get(
      `SELECT reset_token, reset_token_expires 
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    if (!user) {
      console.log(`[userModel] User ${userId} not found`);
      return false;
    }

    if (!user.reset_token) {
      console.log(`[userModel] No reset token for user ${userId}`);
      return false;
    }

    if (user.reset_token !== token) {
      console.log(`[userModel] Reset token mismatch for user ${userId}`);
      return false;
    }

    // Check expiration
    if (new Date(user.reset_token_expires) < new Date()) {
      console.log(`[userModel] Reset token expired for user ${userId}`);
      return false;
    }

    console.log(`[userModel] ✅ Reset token verified for user ${userId}`);
    return true;
  } catch (err) {
    console.error('[userModel] Error in verifyResetToken:', err.message);
    throw err;
  }
}

/**
 * Clear password reset token
 */
async function clearResetToken(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const db = await getDb();

    console.log(`[userModel] Clearing reset token for user ${userId}`);
    
    await db.run(
      `UPDATE users 
       SET reset_token = NULL, reset_token_expires = NULL 
       WHERE id = ?`,
      [userId]
    );

    console.log(`[userModel] ✅ Reset token cleared for user ${userId}`);
  } catch (err) {
    console.error('[userModel] Error in clearResetToken:', err.message);
    throw err;
  }
}

/**
 * Update user password
 */
async function updatePassword(userId, passwordHash) {
  try {
    if (!userId || !passwordHash) {
      throw new Error('User ID and password hash are required');
    }

    const db = await getDb();

    console.log(`[userModel] Updating password for user ${userId}`);
    
    const result = await db.run(
      `UPDATE users 
       SET password_hash = ? 
       WHERE id = ?`,
      [passwordHash, userId]
    );

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    console.log(`[userModel] ✅ Password updated for user ${userId}`);
  } catch (err) {
    console.error('[userModel] Error in updatePassword:', err.message);
    throw err;
  }
}

// ====================== USER PROFILE UPDATES ======================

/**
 * Update user email
 */
async function updateEmail(userId, newEmail) {
  try {
    if (!userId || !newEmail) {
      throw new Error('User ID and email are required');
    }

    const db = await getDb();

    // Check if new email already exists
    const existing = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, userId]);
    if (existing) {
      throw new Error('Email already in use');
    }

    console.log(`[userModel] Updating email for user ${userId} to ${newEmail}`);
    
    await db.run(
      `UPDATE users SET email = ? WHERE id = ?`,
      [newEmail, userId]
    );

    console.log(`[userModel] ✅ Email updated for user ${userId}`);
  } catch (err) {
    console.error('[userModel] Error in updateEmail:', err.message);
    throw err;
  }
}

/**
 * Delete user account
 */
async function deleteUser(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const db = await getDb();

    console.log(`[userModel] Deleting user ${userId}...`);
    
    const result = await db.run(
      `DELETE FROM users WHERE id = ?`,
      [userId]
    );

    if (result.changes === 0) {
      throw new Error(`User ${userId} not found`);
    }

    console.log(`[userModel] ✅ User ${userId} deleted`);
  } catch (err) {
    console.error('[userModel] Error in deleteUser:', err.message);
    throw err;
  }
}

module.exports = {
  // User creation & retrieval
  getOrCreateDefaultUser,
  createUser,
  getUserByEmail,
  getUserById,
  
  // Instagram connection
  getUserWithInstagramToken,
  isInstagramConnected,
  saveInstagramConnection,
  disconnectInstagram,
  getInstagramStatus,
  
  // Password reset
  saveResetToken,
  verifyResetToken,
  clearResetToken,
  updatePassword,
  
  // Profile updates
  updateEmail,
  deleteUser
};