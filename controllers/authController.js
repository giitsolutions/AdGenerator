const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const userModel = require('../models/userModel');
const config = require('../config/env');

const SALT_ROUNDS = 10;

/**
 * Public URL used in emails (reset links, etc.)
 */
function getPublicBaseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    (config && config.appBaseUrl) ||
    (config && config.frontendUrl) ||
    `http://localhost:${(config && config.port) || 5000}`
  ).replace(/\/$/, ''); // remove trailing slash
}

/**
 * User signup/registration
 */
async function signup(req, res, next) {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      console.log('[authController] Signup: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      console.log('[authController] Signup: Password too short');
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await userModel.getUserByEmail(email);
    if (existing) {
      console.log(`[authController] Signup: Email already exists: ${email}`);
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    console.log(`[authController] Signup: Hashing password for ${email}...`);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const userId = await userModel.createUser({ email, passwordHash });
    const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '30d' });

    console.log(`[authController] ✅ Signup successful for ${email} (ID: ${userId})`);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: userId, email, name: name || 'User' }
    });
  } catch (err) {
    console.error('[authController] Signup error:', err.message);
    next(err);
  }
}

/**
 * User login
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      console.log('[authController] Login: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await userModel.getUserByEmail(email);
    if (!user) {
      console.log(`[authController] Login: User not found: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log(`[authController] Login: Verifying password for ${email}...`);
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      console.log(`[authController] Login: Invalid password for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '30d' });

    console.log(`[authController] ✅ Login successful for ${email} (ID: ${user.id})`);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        instagramConnected: !!user.instagram_business_account_id
      }
    });
  } catch (err) {
    console.error('[authController] Login error:', err.message);
    next(err);
  }
}

/**
 * Get current user profile
 */
async function getMe(req, res, next) {
  try {
    if (!req.userId) {
      console.log('[authController] getMe: No user ID in request');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await userModel.getUserById(req.userId);
    if (!user) {
      console.log(`[authController] getMe: User not found: ${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[authController] getMe: Retrieved user profile for ${req.userId}`);

    res.json({
      id: user.id,
      email: user.email,
      instagram_business_account_id: user.instagram_business_account_id,
      instagram_page_name: user.instagram_page_name,
      instagram_access_token: user.instagram_access_token,
      created_at: user.created_at
    });
  } catch (err) {
    console.error('[authController] getMe error:', err.message);
    next(err);
  }
}

/**
 * Update user profile
 */
async function updateProfile(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { email } = req.body;

    if (email) {
      console.log(`[authController] Updating email for user ${req.userId} to ${email}...`);
      await userModel.updateEmail(req.userId, email);
    }

    const user = await userModel.getUserById(req.userId);
    console.log(`[authController] ✅ Profile updated for user ${req.userId}`);

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (err) {
    console.error('[authController] updateProfile error:', err.message);
    next(err);
  }
}

/**
 * Change password
 */
async function changePassword(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      console.log('[authController] changePassword: Missing current or new password');
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    if (newPassword.length < 8) {
      console.log('[authController] changePassword: New password too short');
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const profile = await userModel.getUserById(req.userId);
    const user = await userModel.getUserByEmail(profile.email);

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      console.log(`[authController] changePassword: Invalid current password for user ${req.userId}`);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    console.log(`[authController] changePassword: Hashing new password for user ${req.userId}...`);
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await userModel.updatePassword(req.userId, newPasswordHash);

    console.log(`[authController] ✅ Password changed for user ${req.userId}`);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('[authController] changePassword error:', err.message);
    next(err);
  }
}

/**
 * Delete account
 */
async function deleteAccount(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to delete account' });
    }

    const profile = await userModel.getUserById(req.userId);
    const user = await userModel.getUserByEmail(profile.email);
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      console.log(`[authController] deleteAccount: Invalid password for user ${req.userId}`);
      return res.status(401).json({ error: 'Invalid password' });
    }

    console.log(`[authController] Deleting account for user ${req.userId}...`);
    await userModel.deleteUser(req.userId);

    console.log(`[authController] ✅ Account deleted for user ${req.userId}`);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('[authController] deleteAccount error:', err.message);
    next(err);
  }
}

/**
 * Request password reset (sends email)
 * POST /api/auth/forgot-password  or  /api/auth/reset-request
 * Body: { email }
 */
async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const safeMessage = 'If an account exists, a reset email will be sent';

    const user = await userModel.getUserByEmail(email);
    if (!user) {
      console.log(`[authController] requestPasswordReset: Email not found: ${email}`);
      return res.json({ message: safeMessage });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    console.log(`[authController] Generating password reset token for user ${user.id}...`);
    await userModel.saveResetToken(user.id, resetToken, expiresAt);

    const baseUrl = getPublicBaseUrl();
    const resetLink =
      `${baseUrl}/reset-password.html?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`;

    console.log(`[authController] Reset link base: ${baseUrl}`);

    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('[authController] EMAIL_USER or EMAIL_PASS missing in .env');
      } else {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: email,
          subject: 'Reset your password — AI Instagram Ad Generator',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>Password reset</h2>
              <p>Click the button below to set a new password. This link expires in 1 hour.</p>
              <p style="margin: 28px 0;">
                <a href="${resetLink}"
                   style="background: linear-gradient(135deg,#ff7a3c,#e23a86,#8b3dff);
                          color:#fff;padding:12px 22px;border-radius:8px;
                          text-decoration:none;font-weight:bold;">
                  Reset password
                </a>
              </p>
              <p style="color:#666;font-size:13px;">If you didn't request this, you can ignore this email.</p>
              <p style="color:#999;font-size:12px;word-break:break-all;">${resetLink}</p>
            </div>
          `
        });

        console.log(`[authController] ✅ Reset email sent to ${email}`);
      }
    } catch (mailErr) {
      console.error('[authController] Failed to send reset email:', mailErr.message);
    }

    res.json({ message: safeMessage });
  } catch (err) {
    console.error('[authController] requestPasswordReset error:', err.message);
    next(err);
  }
}

/**
 * Reset password with token
 * POST /api/auth/reset-password
 * Body: { email, token, newPassword }
 */
async function resetPassword(req, res, next) {
  try {
    const { email, token, newPassword, userId } = req.body;

    if ((!email && !userId) || !token || !newPassword) {
      return res.status(400).json({
        error: 'Email (or userId), token, and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    let user = null;
    if (email) {
      user = await userModel.getUserByEmail(email);
    } else {
      user = await userModel.getUserById(userId);
    }

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const isValid = await userModel.verifyResetToken(user.id, token);
    if (!isValid) {
      console.log(`[authController] resetPassword: Invalid/expired token for user ${user.id}`);
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await userModel.updatePassword(user.id, passwordHash);
    await userModel.clearResetToken(user.id);

    console.log(`[authController] ✅ Password reset for user ${user.id}`);
    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[authController] resetPassword error:', err.message);
    next(err);
  }
}

module.exports = {
  signup,
  login,
  getMe,
  updateProfile,
  changePassword,
  deleteAccount,
  requestPasswordReset,
  resetPassword
};