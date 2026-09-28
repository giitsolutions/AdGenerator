const { loadImage } = require('canvas');
const axios = require('axios');
const config = require('../../config/env');
const usedPhotoModel = require('../../models/usedPhotoModel');

/**
 * Searches Pexels with the exact phrase given (no shortening). Same
 * rules as the Unsplash provider: irrelevant photos rejected, photos
 * already used in an earlier post skipped, top matches shuffled.
 */
async function fetchPexelsPhoto(query, { allowReuse = false } = {}) {
  if (!config.pexels.apiKey) {
    console.warn('[pexelsPhotoProvider] PEXELS_API_KEY is missing — skipping.');
    return null;
  }

  const cleanQuery = query.replace(/[.,!?]+$/, '');
  const usedIds = allowReuse ? new Set() : await usedPhotoModel.getUsedIds('pexels');

  try {
    const searchRes = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: cleanQuery, per_page: 30, orientation: 'square' },
      headers: { Authorization: config.pexels.apiKey }
    });

    const results = searchRes.data.photos || [];
    console.log(`[pexelsPhotoProvider] Query "${cleanQuery}" returned ${results.length} result(s).`);
    if (results.length === 0) return null;

    const queryWords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matching = results
      .map(photo => {
        const text = (photo.alt || '').toLowerCase();
        const matches = queryWords.filter(w => text.includes(w)).length;
        return { photo, matches };
      })
      .filter(r => r.matches > 0)
      .sort((a, b) => b.matches - a.matches);

    if (matching.length === 0) {
      console.log('[pexelsPhotoProvider] Results found but none matched the query.');
      return null;
    }

    const fresh = matching.filter(r => !usedIds.has(String(r.photo.id)));
    if (fresh.length === 0) {
      console.log(`[pexelsPhotoProvider] All ${matching.length} matching photos were already used.`);
      return null;
    }

    const topPool = fresh.slice(0, Math.min(5, fresh.length));
    for (let i = topPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
    }
    const candidates = [...topPool, ...fresh.slice(topPool.length)];

    for (const { photo } of candidates) {
      let image;
      try {
        const imageRes = await axios.get(photo.src.large2x || photo.src.large, { responseType: 'arraybuffer' });
        image = await loadImage(Buffer.from(imageRes.data));
      } catch {
        continue;
      }
      await usedPhotoModel.markUsed('pexels', photo.id);
      return image;
    }
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`[pexelsPhotoProvider] Request failed for "${cleanQuery}":`, detail);
  }

  console.warn('[pexelsPhotoProvider] No usable photo found.');
  return null;
}

module.exports = { fetchPexelsPhoto };