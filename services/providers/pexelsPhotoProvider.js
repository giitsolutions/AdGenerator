const { loadImage } = require('canvas');
const axios = require('axios');
const config = require('../../config/env');

/**
 * Searches Pexels (free, different catalog than Unsplash) for a photo
 * matching the given scene description. Same progressive-shortening +
 * relevance-scoring approach as the Unsplash provider. Used as a
 * second attempt when Unsplash doesn't return a good match.
 */
async function fetchPexelsPhoto(query) {
  if (!config.pexels.apiKey) {
    console.warn('[pexelsPhotoProvider] PEXELS_API_KEY is missing — skipping.');
    return null;
  }

  const words = query.split(/\s+/);
  const attempts = [
    words.join(' '),
    words.slice(0, 3).join(' '),
    words.slice(0, 1).join(' ')
  ];

  for (const attemptQuery of attempts) {
    try {
      const searchRes = await axios.get('https://api.pexels.com/v1/search', {
        params: { query: attemptQuery, per_page: 10, orientation: 'square' },
        headers: { Authorization: config.pexels.apiKey }
      });

      const results = searchRes.data.photos || [];
      console.log(`[pexelsPhotoProvider] Query "${attemptQuery}" returned ${results.length} result(s).`);
      if (results.length === 0) continue;

      const queryWords = attemptQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const scored = results
        .map(photo => {
          const text = (photo.alt || '').toLowerCase();
          const matches = queryWords.filter(w => text.includes(w)).length;
          return { photo, matches };
        })
        .filter(r => r.matches > 0) // reject completely irrelevant photos instead of accepting the top listed one
        .sort((a, b) => b.matches - a.matches);

      if (scored.length === 0) {
        console.log(`[pexelsPhotoProvider] "${attemptQuery}" had results but none matched — trying next query.`);
        continue;
      }

      for (const { photo } of scored) {
        try {
          const imageRes = await axios.get(photo.src.large2x || photo.src.large, { responseType: 'arraybuffer' });
          return await loadImage(Buffer.from(imageRes.data));
        } catch {
          continue;
        }
      }
    } catch (err) {
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      console.error(`[pexelsPhotoProvider] Request failed for "${attemptQuery}":`, detail);
    }
  }

  console.warn('[pexelsPhotoProvider] No usable photo found after all attempts.');
  return null;
}

module.exports = { fetchPexelsPhoto };
