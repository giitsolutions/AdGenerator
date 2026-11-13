// services/stockVideoReelService.js
// Reel made from a free Pexels stock video (same PEXELS_API_KEY as the photos)
// that matches the post, plus the logo / brand / caption / offer overlay.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config/env');
const { renderReelOverlay } = require('./reelOverlay');
const { composeFromVideo } = require('./reelRender');

const USED_FILE = path.join(__dirname, '..', 'storage', 'used-stock-videos.json');
const MAX_DOWNLOAD_MB = 150;
const TREADMILL_VIDEO_QUERIES = [
  'treadmill',
  'treadmill workout',
  'walking on a treadmill',
  'running on a treadmill',
  'treadmill exercise',
  'treadmill training',
  'treadmill machine'
];
const reservedVideoIds = new Set();
const MAX_VISUAL_CHECKS = 40;

// Pexels videos already used, so the same clip is not picked again and again.
function readUsed() {
  try {
    const stored = JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('Expected an array of video IDs');
    return new Set(stored.map(String));
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw new Error(`Could not read the used stock-video history: ${error.message}`);
  }
}
function reserveVideo(id) {
  const videoId = String(id);
  const used = readUsed();
  if (used.has(videoId) || reservedVideoIds.has(videoId)) return false;

  used.add(videoId);
  fs.mkdirSync(path.dirname(USED_FILE), { recursive: true });
  const tempFile = `${USED_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify([...used]));
    fs.renameSync(tempFile, USED_FILE);
    reservedVideoIds.add(videoId);
    return true;
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw new Error(`Could not reserve a unique stock video: ${error.message}`);
  }
}

async function searchPexels(query, apiKey) {
  const url = 'https://api.pexels.com/videos/search?size=medium&per_page=80&query=' +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Pexels search failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.videos) ? data.videos : [];
}

// Best mp4 file of one video: smallest one that is still at least 1280 px tall.
function pickFile(video) {
  const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4' && f.link && f.height);
  if (!files.length) return null;
  const big = files.filter(f => f.height >= 1280).sort((a, b) => a.height - b.height);
  return (big[0]) || files.sort((a, b) => b.height - a.height)[0];
}

async function download(link, dest) {
  const res = await fetch(link, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_DOWNLOAD_MB * 1024 * 1024) throw new Error('The stock video is too large');
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function sampleVideoPictures(video) {
  const pictures = (video.video_pictures || [])
    .map((item) => item && item.picture)
    .filter((picture) => typeof picture === 'string' && /^https:\/\//i.test(picture));
  if (!pictures.length) return [];
  const indexes = [...new Set([0, Math.floor((pictures.length - 1) / 2), pictures.length - 1])];
  return indexes.map((index) => pictures[index]);
}

async function loadPictureAsJpeg(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Could not load a stock-video preview (${response.status})`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 8 * 1024 * 1024) throw new Error('Stock-video preview image is too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
    throw new Error('Stock-video preview image is empty or too large');
  }
  return sharp(bytes).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
}

async function showsTargetEquipment(video) {
  const apiKey = config.gemini && config.gemini.apiKey;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required to verify treadmill stock footage');

  const pictureUrls = sampleVideoPictures(video);
  if (!pictureUrls.length) return false;
  const images = await Promise.all(pictureUrls.map(loadPictureAsJpeg));
  const parts = [{
    text: 'Decide whether this stock video is about treadmills. Return true for a person walking, jogging, or running on a treadmill, or a video focused on treadmill equipment. The treadmill or treadmill workout must be a clear, prominent subject in the preview frames. Accept any workout style and any setting, including home, gym, and studio. Reject clips where a treadmill is only incidental or in the background, and reject unrelated exercise equipment or outdoor running. Do not require the treadmill to be visible in every frame; angles, close-ups, or brief occlusion are acceptable if the clip is clearly treadmill-focused. If the previews do not provide clear evidence that the video is about a treadmill, return false. Respond with JSON matching {"relevant": boolean}.'
  }];
  for (const image of images) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } });
  }

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { relevant: { type: 'BOOLEAN' } },
            required: ['relevant']
          }
        }
      }),
      signal: AbortSignal.timeout(30000)
    }
  );
  if (!response.ok) throw new Error(`Stock-video visual check failed (${response.status})`);
  const result = await response.json();
  const text = result.candidates && result.candidates[0] &&
    result.candidates[0].content && result.candidates[0].content.parts &&
    result.candidates[0].content.parts.find((part) => typeof part.text === 'string')?.text;
  if (!text) throw new Error('Stock-video visual check returned no result');
  const verdict = JSON.parse(text);
  return verdict.relevant === true;
}

/** Finds a treadmill-focused stock video and downloads it to destDir. Returns the file path. */
async function fetchStockClip(destDir) {
  const apiKey = config.pexels && config.pexels.apiKey;
  if (!apiKey) throw new Error('PEXELS_API_KEY is not set in your .env file');

  const tried = new Set();
  const candidates = new Map();
  for (const raw of TREADMILL_VIDEO_QUERIES) {
    const query = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!query || tried.has(query.toLowerCase())) continue;
    tried.add(query.toLowerCase());
    let videos = [];
    try { videos = await searchPexels(query, apiKey); } catch (e) { console.warn('[reels]', e.message); continue; }
    const usable = videos.filter(v => v.duration >= 5 && pickFile(v));
    for (const video of usable) {
      if (video.id != null) candidates.set(String(video.id), { video, query });
    }
  }

  const used = readUsed();
  const fresh = [...candidates.entries()].filter(([id]) => !used.has(id));
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }

  let lastCheckError;
  let checked = 0;
  let successfulChecks = 0;
  for (const [id, { video, query }] of fresh) {
    if (checked >= MAX_VISUAL_CHECKS) break;
    checked++;
    let relevant;
    try {
      relevant = await showsTargetEquipment(video);
      successfulChecks++;
    } catch (error) {
      lastCheckError = error;
      console.warn(`[reels] Could not verify stock video ${id}: ${error.message}`);
      continue;
    }
    if (!relevant) {
      console.log(`[reels] Stock video ${id} rejected: it was not clearly focused on a treadmill`);
      continue;
    }
    if (!reserveVideo(id)) continue;
    const dest = path.join(destDir, 'clip.mp4');
    try {
      await download(pickFile(video).link, dest);
      console.log(`[reels] Unique stock video ${id} chosen for "${query}"`);
      return dest;
    } catch (error) {
      console.warn(`[reels] Could not download unique stock video ${id}: ${error.message}`);
    }
  }
  if (lastCheckError && successfulChecks === 0) {
    throw new Error(`Could not verify that stock footage is focused on a treadmill: ${lastCheckError.message}`);
  }
  throw new Error('No unused stock video focused on a treadmill was found; unrelated or incidental treadmill footage is not used');
}

async function generateStockVideoReel({ headline, headlineAccent, subheadline, offer, cta, logoPath, brand, caption, duration, outPath, sourceOutPath }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-stock-'));
  try {
    const videoPath = await fetchStockClip(tmp);
    if (sourceOutPath) {
      await composeFromVideo({ videoPath, duration, outPath: sourceOutPath });
    }
    const overlayPath = path.join(tmp, 'overlay.png');
    fs.writeFileSync(overlayPath, await renderReelOverlay({
      logoPath, brand: brand || headline, headline, headlineAccent, subheadline,
      caption: caption || '', offer, cta
    }));
    await composeFromVideo({ videoPath, overlayPath, duration, outPath });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { generateStockVideoReel, fetchStockClip };