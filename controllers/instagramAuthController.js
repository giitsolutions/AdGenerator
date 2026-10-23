const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userModel = require('../models/userModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// Step 1: User clicks "Connect Instagram"
async function startConnect(req, res) {
  try {
    let userId = null;

    // 1. Try token from query parameter
    if (req.query.token) {
      try {
        const decoded = jwt.verify(req.query.token, config.jwtSecret);
        userId = decoded.userId;
        console.log(`[instagramAuth] User ${userId} starting Instagram connection via query token`);
      } catch (err) {
        console.error('[instagramAuth] Invalid token in query:', err.message);
      }
    }

    // 2. Fallback: Authorization header
    if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, config.jwtSecret);
        userId = decoded.userId;
        console.log(`[instagramAuth] User ${userId} starting Instagram connection via Bearer token`);
      } catch (err) {
        console.error('[instagramAuth] Invalid Bearer token:', err.message);
      }
    }

    // 3. Last fallback - default user
    if (!userId) {
      const defaultUser = await userModel.getOrCreateDefaultUser();
      userId = defaultUser.id;
      console.log(`[instagramAuth] Using default user ${userId} for Instagram connection`);
    }

    // 4. Create signed state JWT
    const state = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '15m' });

    // 5. Define permission scopes
    const scopes = [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
      'business_management'
    ].join(',');

    // 6. Build Facebook OAuth URL
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${config.facebook.appId}` +
      `&redirect_uri=${encodeURIComponent(config.facebook.redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${state}` +
      `&response_type=code`;

    console.log(`[instagramAuth] Redirecting user ${userId} to Facebook OAuth`);
    res.redirect(authUrl);
  } catch (err) {
    console.error('[instagramAuth] startConnect error:', err.message, err.stack);
    res.redirect('/index.html?instagram_error=Unable+to+start+connection');
  }
}

/**
 * Step 2: Facebook redirects back here with authorization code
 */
async function handleCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors from Facebook
  if (error) {
    const errorMsg = error_description || error;
    console.error('[instagramAuth] OAuth error from Facebook:', errorMsg);
    return res.redirect(`/index.html?instagram_error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    // 1. Verify and decode state token to get userId
    let userId;
    try {
      const decoded = jwt.verify(state, config.jwtSecret);
      userId = decoded.userId;
      console.log(`[instagramAuth] State verified for user ${userId}`);
    } catch (err) {
      console.error('[instagramAuth] State verification failed:', err.message);
      return res.redirect('/index.html?instagram_error=Invalid+or+expired+connection+request');
    }

    // 2. Exchange authorization code for short-lived access token
    console.log('[instagramAuth] Exchanging code for short-lived token...');
    const shortTokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        redirect_uri: config.facebook.redirectUri,
        code
      }
    });

    if (!shortTokenRes.data.access_token) {
      throw new Error('No access_token in short-lived token response');
    }

    // 3. Exchange short-lived token for long-lived user token
    console.log('[instagramAuth] Exchanging for long-lived token...');
    const longTokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        fb_exchange_token: shortTokenRes.data.access_token
      }
    });

    if (!longTokenRes.data.access_token) {
      throw new Error('No access_token in long-lived token response');
    }

    const longLivedUserToken = longTokenRes.data.access_token;
    console.log('[instagramAuth] Successfully obtained long-lived user token');

    // 4. Fetch Facebook Pages
    console.log('[instagramAuth] Fetching Facebook pages...');
    let pages = [];
    try {
      const pagesRes = await axios.get(`${GRAPH_BASE}/me/accounts`, {
        params: {
          fields: 'id,name,access_token,instagram_business_account',
          access_token: longLivedUserToken
        }
      });
      pages = pagesRes.data.data || [];
      console.log(`[instagramAuth] Found ${pages.length} Facebook pages`);
    } catch (e) {
      console.warn('[instagramAuth] /me/accounts error:', e.response?.data?.error?.message || e.message);
    }

    // 5. Fallback: Try Business Portfolio if no pages found
    if (pages.length === 0) {
      console.log('[instagramAuth] Fallback: Checking /me/businesses...');
      try {
        const bizRes = await axios.get(`${GRAPH_BASE}/me/businesses`, {
          params: {
            fields: 'id,name,owned_pages{id,name,access_token,instagram_business_account},client_pages{id,name,access_token,instagram_business_account}',
            access_token: longLivedUserToken
          }
        });

        const businesses = bizRes.data.data || [];
        console.log(`[instagramAuth] Found ${businesses.length} businesses`);
        
        for (const biz of businesses) {
          if (biz.owned_pages?.data) {
            pages.push(...biz.owned_pages.data);
            console.log(`[instagramAuth] Added ${biz.owned_pages.data.length} owned pages from business ${biz.name}`);
          }
          if (biz.client_pages?.data) {
            pages.push(...biz.client_pages.data);
            console.log(`[instagramAuth] Added ${biz.client_pages.data.length} client pages from business ${biz.name}`);
          }
        }
      } catch (e) {
        console.error('[instagramAuth] /me/businesses error:', e.response?.data || e.message);
      }
    }

    // 6. Find a page with Instagram Business Account
    console.log('[instagramAuth] Searching for Instagram Business Account...');
    let selectedPage = null;
    let igBusinessAccountId = null;
    let pageAccessToken = null;

    // First try: Check pages that already have instagram_business_account field
    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        selectedPage = page;
        igBusinessAccountId = page.instagram_business_account.id;
        pageAccessToken = page.access_token || longLivedUserToken;
        console.log(`[instagramAuth] Found IG account ${igBusinessAccountId} on page "${page.name}"`);
        break;
      }
    }

    // Fallback: Query each page individually
    if (!igBusinessAccountId && pages.length > 0) {
      console.log('[instagramAuth] Fallback: Querying pages individually for IG account...');
      for (const page of pages) {
        try {
          const igAccountRes = await axios.get(`${GRAPH_BASE}/${page.id}`, {
            params: {
              fields: 'instagram_business_account',
              access_token: page.access_token || longLivedUserToken
            }
          });

          if (igAccountRes.data.instagram_business_account?.id) {
            selectedPage = page;
            igBusinessAccountId = igAccountRes.data.instagram_business_account.id;
            pageAccessToken = page.access_token || longLivedUserToken;
            console.log(`[instagramAuth] Found IG account ${igBusinessAccountId} on page "${page.name}" (via individual query)`);
            break;
          }
        } catch (e) {
          console.warn(`[instagramAuth] Could not check page ${page.id}:`, e.message);
        }
      }
    }

    // 7. Verify we found an Instagram Business Account
    if (!igBusinessAccountId || !selectedPage) {
      console.error('[instagramAuth] No Instagram Business Account found on any page');
      console.error('[instagramAuth] Pages found:', pages.map(p => ({ id: p.id, name: p.name })));
      return res.redirect('/index.html?instagram_error=' + encodeURIComponent(
        'No Instagram Business Account found. Make sure your Facebook Page is linked to an Instagram Business or Creator account.'
      ));
    }

    // 8. Get Instagram page name
    let igPageName = selectedPage.name || 'Unknown';
    try {
      const igNameRes = await axios.get(`${GRAPH_BASE}/${igBusinessAccountId}`, {
        params: {
          fields: 'name',
          access_token: pageAccessToken
        }
      });
      if (igNameRes.data.name) {
        igPageName = igNameRes.data.name;
        console.log(`[instagramAuth] Instagram page name: ${igPageName}`);
      }
    } catch (e) {
      console.warn('[instagramAuth] Could not get Instagram page name:', e.message);
    }

    // 9. Save Instagram connection to database
    console.log(`[instagramAuth] Saving connection for user ${userId}...`);
    const connectionData = {
      accessToken: pageAccessToken,
      businessAccountId: igBusinessAccountId,
      pageName: igPageName
    };

    await userModel.saveInstagramConnection(userId, connectionData);
    console.log(`[instagramAuth] ✅ Successfully saved Instagram connection for user ${userId}`);

    // 10. Redirect to dashboard with success
    res.redirect('/index.html?instagram_connected=1');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[instagramAuth] Connection failed:', detail);
    console.error('[instagramAuth] Full error:', err);
    res.redirect('/index.html?instagram_error=' + encodeURIComponent('Connection failed: ' + err.message));
  }
}

/**
 * Disconnect Instagram account
 */
async function disconnect(req, res, next) {
  try {
    console.log(`[instagramAuth] Disconnecting Instagram for user ${req.userId}...`);
    await userModel.disconnectInstagram(req.userId);
    console.log(`[instagramAuth] ✅ Instagram disconnected for user ${req.userId}`);
    res.json({ message: 'Instagram account disconnected successfully' });
  } catch (err) {
    console.error('[instagramAuth] Disconnect error:', err.message);
    next(err);
  }
}

/**
 * Get Instagram connection status
 */
async function getStatus(req, res, next) {
  try {
    const user = await userModel.getUserById(req.userId);
    
    const status = {
      connected: !!user.instagram_access_token,
      businessAccountId: user.instagram_business_account_id || null,
      pageName: user.instagram_page_name || null
    };

    console.log(`[instagramAuth] Status check for user ${req.userId}:`, status);
    res.json(status);
  } catch (err) {
    console.error('[instagramAuth] Status check error:', err.message);
    next(err);
  }
}

module.exports = { startConnect, handleCallback, disconnect, getStatus };
