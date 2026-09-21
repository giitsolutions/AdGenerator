const axios = require('axios');
const config = require('../config/env');
const userModel = require('../models/userModel');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Step 1: user clicks "Connect Instagram" on our site.
 *
 * TEMPORARY (login disabled for now — see middleware/authMiddleware.js):
 * since there's no logged-in user to identify, this always connects
 * the account for the single default local user. When login is
 * re-enabled later, restore passing/verifying a user token here (via
 * the "state" param) the same way it worked before, instead of
 * hardcoding the default user.
 */
async function startConnect(req, res) {
  const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'].join(',');

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
    `client_id=${config.facebook.appId}` +
    `&redirect_uri=${encodeURIComponent(config.facebook.redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_type=code`;

  res.redirect(authUrl);
}

/**
 * Step 2: Facebook redirects back here after the user approves
 * access. Exchanges the auth code for tokens, finds the user's
 * Instagram Business Account, and saves it against the default local
 * user (see note above) — no Make.com, no external accounts.
 */
async function handleCallback(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.redirect(`/index.html?instagram_error=${encodeURIComponent(error_description || error)}`);
  }

  try {
    const user = await userModel.getOrCreateDefaultUser();

    // Exchange the short-lived auth code for a short-lived access token
    const shortTokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        redirect_uri: config.facebook.redirectUri,
        code
      }
    });

    // Exchange for a long-lived token (~60 days) so the user doesn't
    // have to reconnect constantly
    const longTokenRes = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        fb_exchange_token: shortTokenRes.data.access_token
      }
    });
    const longLivedToken = longTokenRes.data.access_token;

    // Find the user's Facebook Page(s), then the Instagram Business
    // Account connected to it
    const pagesRes = await axios.get(`${GRAPH_BASE}/me/accounts`, {
      params: { access_token: longLivedToken }
    });

    const page = pagesRes.data.data?.[0];
    if (!page) {
      return res.redirect('/index.html?instagram_error=' + encodeURIComponent(
        'No Facebook Page found. Instagram posting requires a Facebook Page linked to your Instagram Business account.'
      ));
    }

    const igAccountRes = await axios.get(`${GRAPH_BASE}/${page.id}`, {
      params: { fields: 'instagram_business_account', access_token: longLivedToken }
    });

    const igBusinessAccountId = igAccountRes.data.instagram_business_account?.id;
    if (!igBusinessAccountId) {
      return res.redirect('/index.html?instagram_error=' + encodeURIComponent(
        'Your Facebook Page isn\'t linked to an Instagram Business account yet. Convert your Instagram to a Business account and link it to this Page, then try again.'
      ));
    }

    await userModel.saveInstagramConnection(user.id, {
      accessToken: longLivedToken,
      businessAccountId: igBusinessAccountId,
      pageName: page.name
    });

    res.redirect('/index.html?instagram_connected=1');
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error('[instagramAuth] Connection failed:', detail);
    res.redirect('/index.html?instagram_error=' + encodeURIComponent('Connection failed. Please try again.'));
  }
}

async function disconnect(req, res, next) {
  try {
    await userModel.disconnectInstagram(req.userId);
    res.json({ message: 'Instagram disconnected' });
  } catch (err) {
    next(err);
  }
}

module.exports = { startConnect, handleCallback, disconnect };
