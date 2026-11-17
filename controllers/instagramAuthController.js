const axios = require('axios');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userModel = require('../models/userModel');

const GRAPH_BASE = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

const SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'business_management'
].join(',');

// Only these pages may be returned to after Facebook (prevents open redirects)
const ALLOWED_RETURN = ['/index.html', '/reels.html'];

function safeReturnPath(value) {
  return ALLOWED_RETURN.includes(value) ? value : '/index.html';
}

// Redirect back to the page the user came from, with query params (empty values are skipped)
function backToDashboard(res, params, base = '/index.html') {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  return res.redirect(base + '?' + qs);
}

/**
 * Step 1: the frontend calls this (POST, logged in) and then sends the browser
 * to the returned URL. The login token never appears in a URL, and there is
 * no default-user fallback: only a logged-in user can connect.
 */
async function getConnectUrl(req, res, next) {
  try {
    const postId = req.body && req.body.postId ? Number(req.body.postId) : null;
    const returnTo = safeReturnPath(req.body && req.body.returnTo);

    // purpose stops a normal login token from being accepted as OAuth state
    const state = jwt.sign(
      { userId: req.userId, postId, returnTo, purpose: 'ig_connect' },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const url =
      `https://www.facebook.com/${config.facebook.graphApiVersion}/dialog/oauth?` +
      `client_id=${config.facebook.appId}` +
      `&redirect_uri=${encodeURIComponent(config.facebook.redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}` +
      `&response_type=code`;

    console.log(`[instagramAuth] User ${req.userId} starting connection (postId: ${postId})`);
    res.json({ url });
  } catch (err) {
    console.error('[instagramAuth] getConnectUrl error:', err.message);
    next(err);
  }
}

/**
 * Step 2: Facebook redirects back here with the authorization code.
 * There is no login header on this request, so the user is identified
 * from the signed state.
 */
async function handleCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  // Verify state first, so we always know the user and the post to return to
  let userId;
  let postId;
  let returnTo = '/index.html';
  try {
    const decoded = jwt.verify(state, config.jwtSecret);
    if (decoded.purpose !== 'ig_connect') throw new Error('Wrong token purpose');
    userId = decoded.userId;
    postId = decoded.postId || null;
    returnTo = safeReturnPath(decoded.returnTo);
    console.log(`[instagramAuth] State verified for user ${userId}`);
  } catch (err) {
    console.error('[instagramAuth] State verification failed:', err.message);
    return backToDashboard(res, {
      instagram_error: 'Invalid or expired connection request. Please try again.'
    });
  }

  const back = params => backToDashboard(res, params, returnTo);

  // The user pressed Cancel, or Facebook returned an error
  if (error) {
    console.warn('[instagramAuth] OAuth error from Facebook:', error_description || error);
    if (error === 'access_denied') {
      return back({ instagram_cancelled: 1, postId });
    }
    return back({ instagram_error: error_description || error, postId });
  }

  try {
    // 1. Authorization code -> short-lived token
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

    // 2. Short-lived -> long-lived user token
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

    // 3. Facebook Pages
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

    // 4. Fallback: pages from a Business Portfolio
    if (pages.length === 0) {
      console.log('[instagramAuth] Fallback: Checking /me/businesses...');
      try {
        const bizRes = await axios.get(`${GRAPH_BASE}/me/businesses`, {
          params: {
            fields:
              'id,name,owned_pages{id,name,access_token,instagram_business_account},client_pages{id,name,access_token,instagram_business_account}',
            access_token: longLivedUserToken
          }
        });
        for (const biz of bizRes.data.data || []) {
          if (biz.owned_pages?.data) pages.push(...biz.owned_pages.data);
          if (biz.client_pages?.data) pages.push(...biz.client_pages.data);
        }
      } catch (e) {
        console.error('[instagramAuth] /me/businesses error:', e.response?.data || e.message);
      }
    }

    // 5. Find a page that has an Instagram Business account
    let selectedPage = null;
    let igBusinessAccountId = null;
    let pageAccessToken = null;

    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        selectedPage = page;
        igBusinessAccountId = page.instagram_business_account.id;
        pageAccessToken = page.access_token || longLivedUserToken;
        console.log(`[instagramAuth] Found IG account ${igBusinessAccountId} on page "${page.name}"`);
        break;
      }
    }

    // Fallback: ask each page individually
    if (!igBusinessAccountId) {
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
            console.log(`[instagramAuth] Found IG account ${igBusinessAccountId} on page "${page.name}" (individual query)`);
            break;
          }
        } catch (e) {
          console.warn(`[instagramAuth] Could not check page ${page.id}:`, e.message);
        }
      }
    }

    if (!igBusinessAccountId || !selectedPage) {
      console.error('[instagramAuth] No Instagram Business Account found. Pages:',
        pages.map(p => ({ id: p.id, name: p.name })));
      return back({
        instagram_error:
          'No Instagram Business Account found. Make sure your Facebook Page is linked to an Instagram Business or Creator account.',
        postId
      });
    }

    // 6. Display name
    let igPageName = selectedPage.name || 'Unknown';
    try {
      const igNameRes = await axios.get(`${GRAPH_BASE}/${igBusinessAccountId}`, {
        params: { fields: 'name', access_token: pageAccessToken }
      });
      if (igNameRes.data.name) igPageName = igNameRes.data.name;
    } catch (e) {
      console.warn('[instagramAuth] Could not get Instagram name:', e.message);
    }

    // 7. Save the connection for this user
    await userModel.saveInstagramConnection(userId, {
      accessToken: pageAccessToken,
      businessAccountId: igBusinessAccountId,
      pageName: igPageName
    });
    console.log(`[instagramAuth] ✅ Saved Instagram connection for user ${userId}`);

    // 8. Back to the page the user started from, to the same post
    return back({ instagram_connected: 1, postId });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[instagramAuth] Connection failed:', detail);
    return back({
      instagram_error: 'Connection failed: ' + (err.response?.data?.error?.message || err.message),
      postId
    });
  }
}

/**
 * Disconnect Instagram account
 */
async function disconnect(req, res, next) {
  try {
    console.log(`[instagramAuth] Disconnecting Instagram for user ${req.userId}...`);
    await userModel.disconnectInstagram(req.userId);
    res.json({ message: 'Instagram account disconnected successfully' });
  } catch (err) {
    console.error('[instagramAuth] Disconnect error:', err.message);
    next(err);
  }
}

/**
 * Get Instagram connection status (never returns the token)
 */
async function getStatus(req, res, next) {
  try {
    const status = await userModel.getInstagramStatus(req.userId);
    res.json(status);
  } catch (err) {
    console.error('[instagramAuth] Status check error:', err.message);
    next(err);
  }
}

module.exports = { getConnectUrl, handleCallback, disconnect, getStatus };