const axios = require('axios');
const config = require('../config/env');
const { ensurePublicImageUrl } = require('./imageService');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function graphErrorMessage(response) {
  const error = response && response.data && response.data.error;
  return error
    ? (error.error_user_msg || error.message || JSON.stringify(error))
    : JSON.stringify(response && response.data);
}

function graphBase() {
  return `https://graph.facebook.com/${config.facebook.graphApiVersion}`;
}

async function graphRequest(method, url, params) {
  const response = await axios({
    method,
    url,
    params,
    timeout: 30000,
    validateStatus: () => true
  });
  if (response.status < 200 || response.status >= 300 || (response.data && response.data.error)) {
    throw new Error('Instagram Graph API: ' + graphErrorMessage(response));
  }
  return response.data;
}

function requireCredentials(instagramBusinessAccountId, accessToken, what) {
  if (!instagramBusinessAccountId || !accessToken) {
    const err = new Error(`Connect an Instagram professional account before publishing ${what}`);
    err.code = 'INSTAGRAM_NOT_CONNECTED';
    throw err;
  }
}

/**
 * Publish an image post to the USER'S OWN Instagram Business account
 * through the Graph API (no Make.com, so every user posts to their own account).
 */
async function publishToInstagram({
  imageUrl,
  caption,
  instagramBusinessAccountId,
  accessToken
}) {
  requireCredentials(instagramBusinessAccountId, accessToken, 'a post');

  // Instagram must be able to download the image, so it needs a public URL.
  const publicImageUrl = await ensurePublicImageUrl(imageUrl);
  console.log('[instagram] Publishing image:', publicImageUrl);

  const base = graphBase();

  // 1. Create the media container
  const container = await graphRequest('post', `${base}/${instagramBusinessAccountId}/media`, {
    image_url: publicImageUrl,
    caption: caption || '',
    access_token: accessToken
  });
  if (!container || !container.id) {
    throw new Error('Instagram did not return a media container ID');
  }

  // 2. Wait until Instagram has finished fetching the image
  let status;
  for (let attempt = 0; attempt < 15; attempt++) {
    status = await graphRequest('get', `${base}/${container.id}`, {
      fields: 'status_code,status',
      access_token: accessToken
    });
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(
        'Instagram image processing failed' +
        (status.status ? ': ' + status.status : ' (' + status.status_code + ')')
      );
    }
    await sleep(2000);
  }
  if (!status || status.status_code !== 'FINISHED') {
    throw new Error('Timed out waiting for Instagram to process the image');
  }

  // 3. Publish
  const published = await graphRequest('post', `${base}/${instagramBusinessAccountId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken
  });
  if (!published || !published.id) {
    throw new Error('Instagram did not confirm the post publication');
  }

  return { ok: true, mediaId: published.id, containerId: container.id, publicImageUrl };
}

function publicVideoUrl(videoUrl) {
  if (!videoUrl) throw new Error('Reel video URL is missing');
  const baseUrl = config.appBaseUrl;
  const resolved = /^https?:\/\//i.test(videoUrl)
    ? new URL(videoUrl)
    : new URL(videoUrl, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const hostname = resolved.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    resolved.protocol !== 'https:' ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('127.') ||
    hostname === '::1'
  ) {
    throw new Error('Instagram Reels require a publicly reachable HTTPS video URL. Set APP_BASE_URL to your deployed HTTPS address.');
  }
  return resolved.toString();
}

async function publishReelToInstagram({
  videoUrl,
  caption,
  instagramBusinessAccountId,
  accessToken
}) {
  requireCredentials(instagramBusinessAccountId, accessToken, 'a Reel');

  const videoPublicUrl = publicVideoUrl(videoUrl);
  const base = graphBase();
  const container = await graphRequest('post', `${base}/${instagramBusinessAccountId}/media`, {
    media_type: 'REELS',
    video_url: videoPublicUrl,
    caption: caption || '',
    share_to_feed: true,
    access_token: accessToken
  });

  if (!container || !container.id) {
    throw new Error('Instagram did not return a Reel media container ID');
  }

  const deadline = Date.now() + config.reels.pollTimeoutMs;
  let status;
  do {
    await sleep(config.reels.pollIntervalMs);
    status = await graphRequest('get', `${base}/${container.id}`, {
      fields: 'status_code,status',
      access_token: accessToken
    });

    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(
        'Instagram Reel processing failed' +
        (status.status ? ': ' + status.status : ' (' + status.status_code + ')')
      );
    }
    if (status.status_code === 'FINISHED') break;
  } while (Date.now() < deadline);

  if (!status || status.status_code !== 'FINISHED') {
    throw new Error('Timed out waiting for Instagram to finish processing the Reel');
  }

  const published = await graphRequest('post', `${base}/${instagramBusinessAccountId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken
  });
  if (!published || !published.id) {
    throw new Error('Instagram did not confirm the Reel publication');
  }

  return { ok: true, mediaId: published.id, containerId: container.id };
}

module.exports = { publishToInstagram, publishReelToInstagram };