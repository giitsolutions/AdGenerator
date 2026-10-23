const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userModel = require('../models/userModel');

/**
 * Middleware to require valid JWT authentication
 * Extracts userId from token and attaches to req.userId
 */
async function requireAuth(req, res, next) {
  try {
    // 1. Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[authMiddleware] No Bearer token in Authorization header');
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // 2. Extract and verify token
    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (err) {
      console.error('[authMiddleware] Token verification failed:', err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // 3. Get userId from token
    const userId = decoded.userId;
    if (!userId) {
      console.error('[authMiddleware] No userId in token payload');
      return res.status(401).json({ error: 'Invalid token format' });
    }

    // 4. Verify user exists in database
    const user = await userModel.getUserById(userId);
    if (!user) {
      console.error('[authMiddleware] User not found:', userId);
      return res.status(401).json({ error: 'User not found' });
    }

    // 5. Attach userId to request
    req.userId = userId;
    req.user = user;

    console.log(`[authMiddleware] ✅ Auth successful for user ${userId}`);
    next();
  } catch (err) {
    console.error('[authMiddleware] Auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional auth - doesn't fail if no token, just attaches user if available
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[authMiddleware] No token provided (optional auth)');
      return next();
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const userId = decoded.userId;
      
      const user = await userModel.getUserById(userId);
      if (user) {
        req.userId = userId;
        req.user = user;
        console.log(`[authMiddleware] Optional auth successful for user ${userId}`);
      }
    } catch (err) {
      console.log('[authMiddleware] Optional auth token invalid:', err.message);
    }

    next();
  } catch (err) {
    console.error('[authMiddleware] Optional auth error:', err.message);
    next();
  }
}

module.exports = { requireAuth, optionalAuth };