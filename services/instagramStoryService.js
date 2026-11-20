// services/instagramStoryService.js
// Publishes a post (image) or a reel (video) as an Instagram STORY on the
// Instagram Business / Creator account the user connected.
const config = require('../config/env');
const { ensurePublicImageUrl } = require('./imageService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function graphBase() {
  return `https://graph.facebook.com/${config.facebook.graphApiVersion}`;
}

async function graph(method, url, params) {
  const target = method === 'get' ? `${url}?${new URLSearchParams(params)}` : url;
  const response = await fetch(target, {
    method: method.toUpperCase(),
    headers: method === 'post' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'post' ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  let data = null;
  try { data = await response.json(); } catch (_) { /* not JSON */ }
  if (!response.ok || (data && data.error)) {
    const e = data && data.error;
    throw new Error('Instagram: ' + ((e && (e.error_user_msg || e.message)) || `request failed (${response.status})`));
  }
  return data;
}

// Instagram downloads the video itself, so it needs a public HTTPS address.
function publicVideoUrl(videoUrl) {
  if (!videoUrl) throw new Error('This item has no video');
  const baseUrl = config.appBaseUrl || '';
  const resolved = /^https?:\/\//i.test(videoUrl)
    ? new URL(videoUrl)
    : new URL(videoUrl, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const host = resolved.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (resolved.protocol !== 'https:' || host === 'localhost' || host.endsWith('.localhost') ||
      host.startsWith('127.') || host === '::1') {
    throw new Error('Instagram needs a public HTTPS address for the video. Set APP_BASE_URL to your public https address.');
  }
  return resolved.toString();
}

/**
 * @param {{imageUrl?:string, videoUrl?:string, instagramBusinessAccountId:string, accessToken:string}} args
 * @returns {Promise<{ok:true, storyId:string}>}
 */
async function publishStoryToInstagram({ imageUrl, videoUrl, instagramBusinessAccountId, accessToken }) {
  if (!instagramBusinessAccountId || !accessToken) {
    const err = new Error('Instagram is not connected. Connect it, then try again.');
    err.code = 'INSTAGRAM_NOT_CONNECTED';
    throw err;
  }
  const isVideo = !!videoUrl;
  const base = graphBase();

  const params = { media_type: 'STORIES', access_token: accessToken };
  if (isVideo) params.video_url = publicVideoUrl(videoUrl);
  else params.image_url = await ensurePublicImageUrl(imageUrl);

  const container = await graph('post', `${base}/${instagramBusinessAccountId}/media`, params);
  if (!container || !container.id) throw new Error('Instagram did not return a Story container ID');

  // Wait until Instagram has processed the media.
  const reels = config.reels || {};
  const interval = reels.pollIntervalMs || 3000;
  const deadline = Date.now() + (isVideo ? (reels.pollTimeoutMs || 120000) : 30000);
  let status;
  do {
    await sleep(isVideo ? interval : 1500);
    status = await graph('get', `${base}/${container.id}`, { fields: 'status_code,status', access_token: accessToken });
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error('Instagram could not process the Story' + (status.status ? `: ${status.status}` : ''));
    }
    if (status.status_code === 'FINISHED') break;
  } while (Date.now() < deadline);
  if (!status || status.status_code !== 'FINISHED') {
    throw new Error('Timed out waiting for Instagram to process the Story');
  }

  const published = await graph('post', `${base}/${instagramBusinessAccountId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken
  });
  if (!published || !published.id) throw new Error('Instagram did not confirm the Story');
  return { ok: true, storyId: published.id };
}

module.exports = { publishStoryToInstagram };