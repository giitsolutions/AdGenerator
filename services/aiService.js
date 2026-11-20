const axios = require('axios');
const config = require('../config/env');
const { buildAdPrompt } = require('../utils/promptBuilder');

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// gemini-2.5-flash is not available to new API accounts (Google's error
// explicitly recommends this replacement for new projects).
const MODEL = 'gemini-3.5-flash-lite';

// Fixed photo prompts for IMAGE posts that have NO topic typed by the user
// (for example the daily automatic posts). When the user types a topic, these
// are NOT used: the photo follows the topic instead.
// To go back to Gemini-written photo descriptions everywhere, make the list empty: [].
// Reels do not use this list: they follow the topic the user typed.
const STATIC_PHOTO_PROMPTS = [
  'a black treadmill, side view, in a bright modern living room, soft daylight, blurred background',
  'a black treadmill, three-quarter view, in a clean home gym with white walls, blurred background',
  'a treadmill in a sunlit room next to a large window, side view, blurred background',
  'a treadmill on a light wooden floor, wide shot, minimal room, soft light, blurred background',
  'a treadmill in a modern apartment, front three-quarter view, warm evening light, blurred background',
  'a treadmill in a bright home gym with a grey wall, side view, soft studio lighting, blurred background',
  'a black and silver treadmill in a bright minimalist room, side view, blurred background'
];

// JSON schema for the ad content - the API enforces this shape directly,
// so we don't need to ask the model to "please output JSON" in the prompt
// or parse loosely-formatted text.
//
// The descriptions below are written for ANY business or topic (yoga, a salon,
// a cafe, a gym...). The examples only show the style, not the subject.
const AD_CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'The post caption. It must be about the theme/topic given in the prompt when there is one; otherwise about the business and its offer. Never mention a product or activity that is not part of that topic.'
    },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Between 18 and 25 relevant hashtags, each starting with #, no spaces inside a tag. Mix broad tags for the industry or topic of this post, niche tags for the specific subject, and tags for this specific business and offer. Never use tags about a different industry or product than the one described.'
    },
    cta: { type: 'string' },
    headlineMain: {
      type: 'string',
      description: 'The first part of the big headline (under 4 words) - part of an EYE-CATCHING, scroll-stopping line built around the theme/topic of this post, e.g. "Fresh Every Morning" - shown in plain white.'
    },
    headlineAccent: {
      type: 'string',
      description: 'The second, emphasized part of the headline (under 3 words), e.g. "Starts Here". Together with headlineMain it must read as one punchy, attention-grabbing headline about the same topic.'
    },
    subheadline: {
      type: 'string',
      description: 'ONE line (under 12 words) shown directly under the headline that plainly states what the post or business is about / what is actually being offered, e.g. "Handmade candles and gift sets, delivered to your door". Concrete, no hype, must not repeat the headline, and must match the topic of this post.'
    },
    tagline: {
      type: 'string',
      description: 'A short catchy slogan (under 6 words) to appear beneath the brand name, e.g. "Made Fresh. Made for You."'
    },
    features: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 4 short feature/benefit phrases (2-4 words each) that fit this business and topic, each PREFIXED with one relevant emoji, e.g. "⭐ Top Quality", "🚚 Fast Delivery", "💰 Flexible Plans", "🛡️ Trusted Service".'
    },
    offerText: {
      type: 'string',
      description: 'The offer line. Copy the "Offer/Details" from the prompt EXACTLY, word for word, with no changes. Only if it says "none specified", write one short complete offer line (up to 10 words).'
    },
    ctaButtonLabel: {
      type: 'string',
      description: 'A very short action label (2-3 words max) PREFIXED with one relevant emoji, e.g. "📅 BOOK NOW", "🛒 SHOP NOW". Must be short enough to fit on a small button - never a full sentence.'
    },
    photoKeywords: {
      type: 'string',
      description: 'A detailed, specific real-world scene description (6-10 words) describing exactly what the photo should show. If the prompt gives a theme/topic, the scene MUST show that topic. Otherwise it must match what THIS SPECIFIC business actually does, based on the product/service description above - do not default to generic stereotypes. The main subject must be the product, equipment, food or physical activity itself, never the room, furniture or interior decor around it, and never words like "cozy", "living room" or "home decor". Examples of the style: for a yoga class, "woman in a yoga pose on a mat"; for a cafe, the food or drink itself; for a shoe brand, a studio product shot; for a running brand, an outdoor running scene. Be concrete and unambiguous, avoid the brand name.'
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
// retried - retrying those just wastes time.
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

// "Summer yoga class, 30% off!" -> "summer yoga class"
function topicPhrase(topic) {
  return String(topic || '')
    .replace(/\d+\s*%\s*(off)?/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

async function generateAdContent(campaignInput) {
  // The topic the user typed for this post (empty for automatic posts).
  const topic = String(campaignInput.topic || '').trim();

  // buildAdPrompt may already use a "theme"; a typed topic is treated the same way.
  let prompt = buildAdPrompt({
    ...campaignInput,
    theme: campaignInput.theme || topic || undefined
  });

  if (topic) {
    prompt += `

IMPORTANT - POST TOPIC FROM THE USER: "${topic}".
Write the headline, subheadline, caption, hashtags, features and the photo description about THIS topic only.
Do not write about any other product, equipment or activity that is not part of this topic, even if the business description mentions it.
Keep the business name "${campaignInput.productName}" where it fits naturally.`;
  }

  let response;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await callGemini(prompt);
      break; // success - stop retrying
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
      console.warn(`[aiService] Gemini returned ${status} (attempt ${attempt}/${MAX_ATTEMPTS}) - retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }

  const modelOutputStep = response.data.steps.find(step => step.type === 'model_output');
  if (!modelOutputStep) {
    throw new Error('No model output returned from Gemini');
  }

  const textBlock = modelOutputStep.content.find(block => block.type === 'text');
  const parsed = JSON.parse(textBlock.text);

  // The offer is shown on the image exactly as the user entered it -
  // never the model's rewording of it. (If the campaign has no offer,
  // the model's own offerText is kept as a fallback.)
  const userOffer = (campaignInput.offerDetails || '').trim();
  if (userOffer) parsed.offerText = userOffer;

  if (topic) {
    // A typed topic always wins: the photo must show the topic, never a fixed subject.
    const wrongSubject = /treadmill/i.test(parsed.photoKeywords || '') && !/treadmill/i.test(topic);
    if (!parsed.photoKeywords || wrongSubject) {
      parsed.photoKeywords = topicPhrase(topic) || topic;
    }
  } else if (STATIC_PHOTO_PROMPTS.length > 0 && !campaignInput.isReel) {
    // No topic typed (automatic posts): fixed photo prompt, as before.
    parsed.photoKeywords = STATIC_PHOTO_PROMPTS[Math.floor(Math.random() * STATIC_PHOTO_PROMPTS.length)];
  }

  return parsed; // { caption, hashtags, cta, headlineMain, headlineAccent, subheadline, tagline, features, offerText, ctaButtonLabel, photoKeywords }
}

module.exports = { generateAdContent };