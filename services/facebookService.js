const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config/env');

const REEL_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'reels');

const GRAPH_BASE = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

// Facebook must be able to download the file, so it needs a full public URL.
// A relative path like /uploads/reels/x.mp4 gets your public site address added
// (taken from the Facebook redirect URI, which already points at your public host).
function toPublicUrl(url) {
  if (!url) throw new Error('No media URL to publish.');
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(config.facebook.redirectUri).origin;
  return origin + (url.startsWith('/') ? url : '/' + url);
}

async function graphPost(url, params) {
  try {
    const res = await axios.post(url, new URLSearchParams(params));
    return res.data;
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    throw new Error(message);
  }
}

// Path of the reel file on this server, or null if the URL is not one of ours
async function findLocalReel(videoUrl) {
  const prefix = '/uploads/reels/';
  if (typeof videoUrl !== 'string' || !videoUrl.startsWith(prefix)) return null;
  const filename = videoUrl.slice(prefix.length);
  if (!filename || path.basename(filename) !== filename) return null;
  const full = path.join(REEL_UPLOAD_DIR, filename);
  try {
    await fs.access(full);
    return full;
  } catch (_) {
    return null;
  }
}

// Image post on the Page
async function publishPhotoToFacebook({ pageId, pageToken, imageUrl, caption }) {
  return graphPost(`${GRAPH_BASE}/${pageId}/photos`, {
    url: toPublicUrl(imageUrl),
    caption: caption || '',
    access_token: pageToken
  });
}

// Reel on the Page: start -> upload (Facebook downloads from our URL) -> finish
async function publishReelToFacebook({ pageId, pageToken, videoUrl, caption }) {
  const start = await graphPost(`${GRAPH_BASE}/${pageId}/video_reels`, {
    upload_phase: 'start',
    access_token: pageToken
  });
  if (!start.video_id || !start.upload_url) {
    throw new Error('Facebook did not return an upload session for the reel.');
  }

  // Send the file bytes straight from disk, so Facebook never has to download
  // the video from our public address (its fetcher obeys robots.txt and fails).
  const localFile = await findLocalReel(videoUrl);
  try {
    if (localFile) {
      const buffer = await fs.readFile(localFile);
      await axios.post(start.upload_url, buffer, {
        headers: {
          Authorization: `OAuth ${pageToken}`,
          offset: '0',
          file_size: String(buffer.length),
          'Content-Type': 'application/octet-stream'
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
    } else {
      // Fallback: let Facebook download it from a public URL
      await axios.post(start.upload_url, null, {
        headers: {
          Authorization: `OAuth ${pageToken}`,
          file_url: toPublicUrl(videoUrl)
        }
      });
    }
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error('Facebook reel upload failed: ' + detail);
  }

  return graphPost(`${GRAPH_BASE}/${pageId}/video_reels`, {
    upload_phase: 'finish',
    video_id: start.video_id,
    video_state: 'PUBLISHED',
    description: caption || '',
    access_token: pageToken
  });
}

module.exports = { publishPhotoToFacebook, publishReelToFacebook, toPublicUrl };