const axios = require('axios');
const config = require('../config/env');
const { buildAdPrompt } = require('../utils/promptBuilder');

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// gemini-2.5-flash is not available to new API accounts (Google's error
// explicitly recommends this replacement for new projects).
const MODEL = 'gemini-3.5-flash-lite';

// Fixed photo prompts. When this list is NOT empty, every post's background is
// generated from one of these (picked at random) instead of the description
// Gemini writes. One machine per image gives the cleanest results.
// To go back to Gemini-written photo descriptions, make the list empty: [].
const STATIC_PHOTO_PROMPTS = [
  'a black treadmill, side view, in a bright modern living room, soft daylight, blurred background',
  'a black treadmill, three-quarter view, in a clean home gym with white walls, blurred background',
  'a treadmill in a sunlit room next to a large window, side view, blurred background',
  'a treadmill on a light wooden floor, wide shot, minimal room, soft light, blurred background',
  'a treadmill in a modern apartment, front three-quarter view, warm evening light, blurred background',
  'a treadmill in a bright home gym with a grey wall, side view, soft studio lighting, blurred background',
  'a black and silver treadmill in a bright minimalist room, side view, blurred background',
  'a black cross trainer elliptical machine, side view, in a bright modern living room, soft daylight, blurred background',
  'a cross trainer elliptical machine, three-quarter view, in a clean home gym with white walls, blurred background',
  'an elliptical cross trainer in a sunlit room next to a large window, side view, blurred background',
  'an elliptical cross trainer on a light wooden floor, wide shot, minimal room, soft light, blurred background',
  'a cross trainer in a bright home gym with a grey wall, side view, soft studio lighting, blurred background',
  'a black and silver elliptical cross trainer in a bright minimalist room, side view, blurred background'
];

// JSON schema for the ad content — the API enforces this shape directly,
// so we don't need to ask the model to "please output JSON" in the prompt
// or parse loosely-formatted text.
const AD_CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' },
    headlineMain: {
      type: 'string',
      description: 'The first part of the big headline (under 4 words) — part of an EYE-CATCHING, scroll-stopping line built around today\'s theme, e.g. "Premium Treadmills" — shown in plain white.'
    },
    headlineAccent: {
      type: 'string',
      description: 'The second, emphasized part of the headline (under 3 words), e.g. "on Rent". Together with headlineMain it must read as one punchy, attention-grabbing headline.'
    },
    subheadline: {
      type: 'string',
      description: 'ONE line (under 12 words) shown directly under the headline that plainly states what the business is about / what is actually being sold, e.g. "Premium treadmills and home gym equipment, delivered to your door". Concrete, no hype, must not repeat the headline.'
    },
    tagline: {
      type: 'string',
      description: 'A short catchy slogan (under 6 words) to appear beneath the brand name, e.g. "Your Fitness. Our Space."'
    },
    features: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 4 short feature/benefit phrases (2-4 words each), each PREFIXED with one relevant emoji, e.g. "🏠 Top Quality Equipment", "🔧 Hassle-Free Setup", "💰 Flexible Plans", "🛡️ Clean & Hygienic".'
    },
    offerText: {
      type: 'string',
      description: 'The offer line. Copy the "Offer/Details" from the prompt EXACTLY, word for word, with no changes. Only if it says "none specified", write one short complete offer line (up to 10 words).'
    },
    ctaButtonLabel: {
      type: 'string',
      description: 'A very short action label (2-3 words max) PREFIXED with one relevant emoji, e.g. "📅 BOOK NOW", "🛒 SHOP NOW". Must be short enough to fit on a small button — never a full sentence.'
    },
        photoKeywords: {
      type: 'string',
      description: 'A detailed, specific real-world scene description (6-10 words) describing exactly what the product photo should show. The setting MUST match what THIS SPECIFIC business actually does, based on the product/service description above — do not default to generic fitness stereotypes. IMPORTANT: if the business involves fitness, exercise, or gym equipment (even if it operates in homes), the photo\'s main subject must be the EQUIPMENT or the PHYSICAL ACTIVITY itself (a treadmill, dumbbells, a person mid-exercise) — never the room, furniture, or interior decor around it, and never words like "cozy", "living room", or "home decor". For a running or outdoor training brand, an outdoor running scene is correct. For a shoe brand, a studio product shot. For a cafe, the food/drink itself. Read the product name and offer details carefully and pick the setting that genuinely matches that business — be concrete and unambiguous, avoid the brand name.'
    }
  },
  required: [
    'caption', 'hashtags', 'cta',
    'headlineMain', 'headlineAccent', 'subheadline',
    'tagline', 'features', 'offerText', 'ctaButtonLabel', 'photoKeywords'
  ]
};

// Retryable = Google's side being temporarily unavailable/overloaded
// (500, 502, 503) or a short-window rate limit (429). These are
// transient and usually succeed on a retry a few seconds later.
// Permanent errors (bad key = 401/403, bad request = 400) are NOT
// retried — retrying those just wastes time.
const RETRYABLE_STATUS = [429, 500, 502, 503];
const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGemini(prompt) {
  return axios.post(
    INTERACTIONS_URL,
    {
      model: MODEL,
      input: prompt,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: AD_CONTENT_SCHEMA
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // New-format ("AQ.") Auth keys and legacy ("AIzaSy") Standard keys
        // both authenticate via this header rather than a ?key= query param.
        'x-goog-api-key': config.gemini.apiKey
      }
    }
  );
}

async function generateAdContent(campaignInput) {
  const prompt = buildAdPrompt(campaignInput);

  let response;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await callGemini(prompt);
      break; // success — stop retrying
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const isRetryable = RETRYABLE_STATUS.includes(status);

      if (!isRetryable || attempt === MAX_ATTEMPTS) {
        throw err; // permanent error, or we've run out of attempts
      }

      // Exponential backoff: 3s, then 6s (keeps total wait reasonable
      // for a background job while riding out a brief Google hiccup).
      const waitMs = 3000 * attempt;
      console.warn(`[aiService] Gemini returned ${status} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }

  const modelOutputStep = response.data.steps.find(step => step.type === 'model_output');
  if (!modelOutputStep) {
    throw new Error('No model output returned from Gemini');
  }

  const textBlock = modelOutputStep.content.find(block => block.type === 'text');
  const parsed = JSON.parse(textBlock.text);

  // The offer is shown on the image exactly as the user entered it —
  // never the model's rewording of it. (If the campaign has no offer,
  // the model's own offerText is kept as a fallback.)
  const userOffer = (campaignInput.offerDetails || '').trim();
  if (userOffer) parsed.offerText = userOffer;

  // Fixed photo prompt (treadmills / cross trainers): replaces whatever photo
  // description the model wrote. The image itself is still generated on the
  // spot for every post.
  if (STATIC_PHOTO_PROMPTS.length > 0) {
    parsed.photoKeywords = STATIC_PHOTO_PROMPTS[Math.floor(Math.random() * STATIC_PHOTO_PROMPTS.length)];
  }

  return parsed; // { caption, hashtags, cta, headlineMain, headlineAccent, subheadline, tagline, features, offerText, ctaButtonLabel, photoKeywords }
}

module.exports = { generateAdContent };