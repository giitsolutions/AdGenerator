const axios = require('axios');
const config = require('../config/env');
const { ensurePublicImageUrl, renderStoryImage } = require('./imageService');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function graphErrorMessage(response) {
  const error = response && response.data && response.data.error;
  return error
    ? (error.error_user_msg || error.message || JSON.stringify(error))
    : JSON.stringify(response && response.data);
}

async function publishToInstagram({ imageUrl, caption }) {
  const webhookUrl =
    (config.make && config.make.webhookUrl) ||
    process.env.MAKE_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error('Make.com webhook URL is not configured');
  }

  const publicImageUrl = await ensurePublicImageUrl(imageUrl);

  const payload = {
    imageUrl: publicImageUrl,
    image_url: publicImageUrl,
    caption: caption || ''
  };

  console.log('[instagram] Make imageUrl:', publicImageUrl);

  const response = await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error('Make webhook HTTP ' + response.status + ': ' + JSON.stringify(response.data));
  }

  const data = response.data;
  if (data && (data.error || data.status === 'error')) {
    throw new Error(data.error || data.message || 'Make returned an error');
  }

  return { ok: true, publicImageUrl, makeResponse: data };
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

async function publishReelToInstagram({
  videoUrl,
  caption,
  instagramBusinessAccountId,
  accessToken
}) {
  if (!instagramBusinessAccountId || !accessToken) {
    throw new Error('Connect an Instagram professional account before publishing a Reel');
  }

  const videoPublicUrl = publicVideoUrl(videoUrl);
  const graphBase = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;
  const container = await graphRequest('post', `${graphBase}/${instagramBusinessAccountId}/media`, {
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
    status = await graphRequest('get', `${graphBase}/${container.id}`, {
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

  const published = await graphRequest('post', `${graphBase}/${instagramBusinessAccountId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken
  });
  if (!published || !published.id) {
    throw new Error('Instagram did not confirm the Reel publication');
  }

  return { ok: true, mediaId: published.id, containerId: container.id };
}

/**
 * Publishes an Instagram STORY (image or video). Stories take no caption.
 *   mediaType: 'video' -> mediaUrl is a video (for example a reel, already 9:16)
 *   mediaType: 'image' -> mediaUrl is any post image; it is turned into a
 *                         tall 1080x1920 Story picture first.
 * Only Instagram Business accounts can publish Stories through the API.
 */
async function publishStoryToInstagram({
  mediaType,
  mediaUrl,
  instagramBusinessAccountId,
  accessToken
}) {
  if (!instagramBusinessAccountId || !accessToken) {
    throw new Error('Connect an Instagram Business account before publishing a Story');
  }

  const graphBase = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;
  const params = { media_type: 'STORIES', access_token: accessToken };

  if (mediaType === 'video') {
    params.video_url = publicVideoUrl(mediaUrl);
  } else {
    params.image_url = await renderStoryImage(mediaUrl);
    console.log('[instagram] Story image:', params.image_url);
  }

  const container = await graphRequest('post', `${graphBase}/${instagramBusinessAccountId}/media`, params);
  if (!container || !container.id) {
    throw new Error('Instagram did not return a Story media container ID');
  }

  const deadline = Date.now() + config.reels.pollTimeoutMs;
  let status;
  do {
    await sleep(config.reels.pollIntervalMs);
    status = await graphRequest('get', `${graphBase}/${container.id}`, {
      fields: 'status_code,status',
      access_token: accessToken
    });

    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(
        'Instagram Story processing failed' +
        (status.status ? ': ' + status.status : ' (' + status.status_code + ')')
      );
    }
    if (status.status_code === 'FINISHED') break;
  } while (Date.now() < deadline);

  if (!status || status.status_code !== 'FINISHED') {
    throw new Error('Timed out waiting for Instagram to finish processing the Story');
  }

  const published = await graphRequest('post', `${graphBase}/${instagramBusinessAccountId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken
  });
  if (!published || !published.id) {
    throw new Error('Instagram did not confirm the Story publication');
  }

  return { ok: true, mediaId: published.id, containerId: container.id };
}

module.exports = { publishToInstagram, publishReelToInstagram, publishStoryToInstagram };