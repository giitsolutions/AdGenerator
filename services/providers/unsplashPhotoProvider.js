const { loadImage } = require('canvas');
const axios = require('axios');
const config = require('../../config/env');

/**
 * ACTIVE image provider (tried first, with Pexels as a second attempt
 * if this finds nothing — see services/providers/pexelsPhotoProvider.js
 * and imageService.js for how they're chained together).
 *
 * Searches Unsplash for a stock photo matching the given scene
 * description. Long, specific queries often return zero results, so
 * this tries progressively shorter versions of the query. Within each
 * attempt, candidate photos are scored first by how many query words
 * appear in their description/tags, then by like-count as a tiebreaker
 * (so among equally relevant photos, the more polished/popular one
 * wins). Returns null if nothing usable is found at all.
 */
async function fetchStockPhoto(query) {
  if (!config.unsplash.accessKey) {
    console.warn('[unsplashPhotoProvider] UNSPLASH_ACCESS_KEY is missing — skipping stock photo search.');
    return null;
  }

  const words = query.split(/\s+/);
  const attempts = [
    words.join(' '),             // full phrase
    words.slice(0, 3).join(' '), // first 3 words
    words.slice(0, 1).join(' ')  // just the first word
  ];

  for (const attemptQuery of attempts) {
    try {
      const searchRes = await axios.get('https://api.unsplash.com/search/photos', {
        params: { query: attemptQuery, per_page: 10, orientation: 'squarish' },
        headers: { Authorization: `Client-ID ${config.unsplash.accessKey}` }
      });

      const results = searchRes.data.results || [];
      console.log(`[unsplashPhotoProvider] Query "${attemptQuery}" returned ${results.length} result(s).`);
      if (results.length === 0) continue;

      const queryWords = attemptQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const scored = results
        .map(result => {
          const text = `${result.alt_description || ''} ${result.description || ''}`.toLowerCase();
          const matches = queryWords.filter(w => text.includes(w)).length;
          return { result, matches, likes: result.likes || 0 };
        })
        .filter(r => r.matches > 0)
        .sort((a, b) => (b.matches - a.matches) || (b.likes - a.likes));

      if (scored.length === 0) {
        console.log(`[unsplashPhotoProvider] "${attemptQuery}" had results but none matched — trying next query.`);
        continue;
      }

      // Randomize among the top few equally-good matches instead of
      // always picking #1 — otherwise identical/near-identical
      // photoKeywords across generations always return the same photo.
      const topPool = scored.slice(0, Math.min(5, scored.length));
      for (let i = topPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
      }
      const rest = scored.slice(topPool.length);
      const shuffledCandidates = [...topPool, ...rest];

      for (const { result } of shuffledCandidates) {
        try {
          const imageRes = await axios.get(result.urls.regular, { responseType: 'arraybuffer' });
          return await loadImage(Buffer.from(imageRes.data));
        } catch {
          continue;
        }
      }
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      console.error(`[unsplashPhotoProvider] Request failed for "${attemptQuery}":`, detail);
    }
  }

  console.warn('[unsplashPhotoProvider] No usable photo found after all attempts.');
  return null;
}

module.exports = { fetchStockPhoto };
