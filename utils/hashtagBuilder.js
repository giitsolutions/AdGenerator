/**
 * Cleans the hashtags the AI returns so every post gets a tidy,
 * specific set: no duplicates, no spammy catch-all tags, valid characters,
 * a brand tag, and at most `max` tags (Instagram reach is better with
 * 5-10 specific hashtags than with 30 generic ones).
 */

// Tags that reach nobody useful (huge, spammy, or "follow-for-follow" style).
const GENERIC = new Set([
  'love', 'instagood', 'photooftheday', 'fashion', 'beautiful', 'happy', 'cute',
  'follow', 'followme', 'like4like', 'likeforlike', 'f4f', 'l4l', 'followforfollow',
  'tagsforlikes', 'instadaily', 'picoftheday', 'fyp', 'foryou', 'viral', 'trending',
  'explore', 'explorepage', 'instagram', 'insta', 'photo', 'bestoftheday', 'amazing'
]);

function toCamelTag(text) {
  const words = String(text || '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  return words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

function normalizeTag(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/^#+/, '');
  // keep letters, digits and underscore only (no spaces, dashes, emojis)
  t = t.replace(/[^\p{L}\p{N}_]/gu, '');
  if (t.length < 3 || t.length > 30) return '';
  if (/^\d+$/.test(t)) return '';
  return '#' + t;
}

/**
 * @param {string[]|string} raw      hashtags from the AI
 * @param {object} opts
 * @param {string} opts.productName  used to add one brand tag
 * @param {number} opts.max          maximum number of tags (default 10)
 */
function cleanHashtags(raw, { productName = '', max = 10 } = {}) {
  let list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);

  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const key = tag.slice(1).toLowerCase();
    if (GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }

  // Make sure the brand/product tag is there (e.g. #HomeTreadmillRental).
  const brand = normalizeTag(toCamelTag(productName));
  if (brand && !seen.has(brand.slice(1).toLowerCase())) {
    out.unshift(brand);
  }

  return out.slice(0, max);
}

module.exports = { cleanHashtags };