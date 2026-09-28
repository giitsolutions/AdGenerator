const { loadImage } = require('canvas');
const axios = require('axios');
const config = require('../../config/env');
const usedPhotoModel = require('../../models/usedPhotoModel');

/**
 * Searches Unsplash with the exact phrase given (no shortening).
 * Photos with zero relevance are rejected, and photos already used in
 * an earlier post are skipped, so the same picture never appears twice.
 * { allowReuse: true } ignores the used list; imageService only does
 * that as a last resort when nothing unused is left.
 */
async function fetchStockPhoto(query, { allowReuse = false } = {}) {
  if (!config.unsplash.accessKey) {
    console.warn('[unsplashPhotoProvider] UNSPLASH_ACCESS_KEY is missing — skipping stock photo search.');
    return null;
  }

  const cleanQuery = query.replace(/[.,!?]+$/, '');
  const usedIds = allowReuse ? new Set() : await usedPhotoModel.getUsedIds('unsplash');

  try {
    const searchRes = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query: cleanQuery, per_page: 30, orientation: 'squarish' },
      headers: { Authorization: `Client-ID ${config.unsplash.accessKey}` }
    });

    const results = searchRes.data.results || [];
    console.log(`[unsplashPhotoProvider] Query "${cleanQuery}" returned ${results.length} result(s).`);
    if (results.length === 0) return null;

    const queryWords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const matching = results
      .map(result => {
        const text = `${result.alt_description || ''} ${result.description || ''}`.toLowerCase();
        const matches = queryWords.filter(w => text.includes(w)).length;
        return { result, matches, likes: result.likes || 0 };
      })
      .filter(r => r.matches > 0)
      .sort((a, b) => (b.matches - a.matches) || (b.likes - a.likes));

    if (matching.length === 0) {
      console.log('[unsplashPhotoProvider] Results found but none matched the query.');
      return null;
    }

    const fresh = matching.filter(r => !usedIds.has(String(r.result.id)));
    if (fresh.length === 0) {
      console.log(`[unsplashPhotoProvider] All ${matching.length} matching photos were already used.`);
      return null;
    }

    // Shuffle the top few so similar queries still give variety.
    const topPool = fresh.slice(0, Math.min(5, fresh.length));
    for (let i = topPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
    }
    const candidates = [...topPool, ...fresh.slice(topPool.length)];

    for (const { result } of candidates) {
      let image;
      try {
        const imageRes = await axios.get(result.urls.regular, { responseType: 'arraybuffer' });
        image = await loadImage(Buffer.from(imageRes.data));
      } catch {
        continue;
      }
      await usedPhotoModel.markUsed('unsplash', result.id);
      return image;
    }
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error(`[unsplashPhotoProvider] Request failed for "${cleanQuery}":`, detail);
  }

  console.warn('[unsplashPhotoProvider] No usable photo found.');
  return null;
}

module.exports = { fetchStockPhoto };