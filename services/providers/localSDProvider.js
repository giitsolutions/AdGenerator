const axios = require('axios');
const { loadImage } = require('canvas');
const config = require('../../config/env');

// Words that make the model draw a person. Image models do not understand
// "no people", so these have to be removed from the prompt itself, not
// just countered with a negative prompt.
const PEOPLE_WORDS = [
  'person', 'people', 'man', 'men', 'woman', 'women', 'guy', 'girl', 'boy', 'lady',
  'athlete', 'athletes', 'athletic', 'weightlifter', 'bodybuilder', 'powerlifter', 'runner', 'jogger',
  'trainer', 'coach', 'client', 'customer', 'user', 'member', 'instructor',
  'professional', 'professionals', 'worker', 'someone', 'individual', 'couple', 'family', 'friends',
  'muscular', 'fit', 'energetic', 'determined', 'smiling', 'focused',
  'hand', 'hands', 'arm', 'arms', 'leg', 'legs', 'body', 'face', 'fingers', 'grip', 'gripping',
  'lifting', 'lifts', 'holding', 'carrying', 'running', 'sprinting', 'jogging', 'walking',
  'exercising', 'working', 'doing', 'using', 'performing', 'training', 'session', 'intense'
];
const PEOPLE_REGEX = new RegExp(`\\b(${PEOPLE_WORDS.join('|')})\\b`, 'gi');
const FILLER_AFTER_STRIP = /\b(a|an|the|of|by|while|during|with|and|on|in|at)\b(?=\s*(,|$))/gi;
const FILLER_AT_START = /^(a|an|the|of|by|while|during|with|and|on|in|at)\b\s*/i;

// Used only to decide whether a stripped fitness description still names a setting.
const FITNESS = /\b(gym|dumbbells?|barbells?|treadmills?|weights?|workout|fitness|exercise|kettlebells?|cross trainer|elliptical)\b/i;
const SETTING = /\b(gym|studio|room|floor|rack|space|fitness|window|garage)\b/i;

/**
 * Turns Gemini's photo description into an equipment-and-setting-only
 * prompt: "Energetic athlete lifting heavy dumbbells in a modern gym"
 * becomes "heavy dumbbells in a modern gym". Falls back to a generic
 * gym scene if nothing useful is left.
 */
function removePeopleFromPrompt(query) {
  const text = query
    .replace(/[.!?]+$/, '')
    .replace(/\b(during|while)\b.*$/i, '') // a clause about what a person is doing
    .replace(/\bworking out\b/gi, ' ')
    .replace(PEOPLE_REGEX, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(FILLER_AFTER_STRIP, '')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(FILLER_AT_START, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (text.split(/\s+/).filter(Boolean).length < 2) {
    return 'modern gym equipment in a bright, clean gym';
  }
  // Fitness prompts that lost their setting along with the person get a default one.
  if (FITNESS.test(query) && !SETTING.test(text)) {
    return `${text} in a bright modern gym`;
  }
  return text;
}

/**
 * Generates the background photo on the spot with the Stable Diffusion
 * server running on the Mac mini (see app.py). The prompt asks for the
 * scene only — all text on the ad is drawn afterwards by the canvas
 * templates in imageService.js, since this model can't spell reliably.
 * Returns null on ANY problem (server off, wrong key, timeout), so
 * imageService falls back to Unsplash/Pexels and a post never fails
 * just because the image server was unreachable.
 */
async function fetchLocalSDPhoto(query) {
  const { url, apiKey, promptSuffix, negativePrompt, stripPeople, timeoutMs } = config.localSD;
  if (!url) return null;

  const scene = stripPeople ? removePeopleFromPrompt(query) : query.replace(/[.,!?]+$/, '');
  const prompt = `${scene}${promptSuffix}`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    console.log(`[localSDProvider] Prompt sent: "${prompt}"`);
    console.log('[localSDProvider] Requesting an image — this takes a few minutes...');
    const response = await axios.post(
      url,
      { prompt, negative_prompt: negativePrompt },
      { headers, responseType: 'arraybuffer', timeout: timeoutMs }
    );
    const image = await loadImage(Buffer.from(response.data));
    console.log('[localSDProvider] Generated a background image locally.');
    return image;
  } catch (err) {
    const detail = err.response
      ? `status ${err.response.status}`
      : err.code === 'ECONNREFUSED' ? 'server not reachable (is app.py running on the Mac mini?)'
      : err.message;
    console.warn('[localSDProvider] Could not generate an image, using stock photos instead:', detail);
    return null;
  }
}

module.exports = { fetchLocalSDPhoto, removePeopleFromPrompt };