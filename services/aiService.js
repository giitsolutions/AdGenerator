const axios = require('axios');
const config = require('../config/env');
const { buildAdPrompt } = require('../utils/promptBuilder');

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// gemini-2.5-flash is not available to new API accounts (Google's error
// explicitly recommends this replacement for new projects).
const MODEL = 'gemini-3.6-flash';

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
      description: 'The first part of the big headline (under 4 words), e.g. "Premium Treadmills" — shown in plain white.'
    },
    headlineAccent: {
      type: 'string',
      description: 'The second, emphasized part of the headline (under 3 words), e.g. "on Rent" — shown in a bright accent color to stand out from headlineMain.'
    },
    subheadline: {
      type: 'string',
      description: 'A short supporting line under the headline (under 10 words), e.g. "Stay consistent. Stay fit. Right from home."'
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
      description: 'The core offer, short enough to fit inside a circular badge (under 6 words) — e.g. "20% OFF Membership", "Buy 1 Get 1 Free".'
    },
    ctaButtonLabel: {
      type: 'string',
      description: 'A very short action label (2-3 words max) PREFIXED with one relevant emoji, e.g. "📅 BOOK NOW", "🛒 SHOP NOW". Must be short enough to fit on a small button — never a full sentence.'
    },
    photoKeywords: {
      type: 'string',
      description: 'A detailed, specific real-world scene description (6-10 words) describing exactly what the product photo should show, tied precisely to the product/service category. E.g. for a home gym service: "person running on treadmill at home". For a shoe brand: "single running shoe studio product shot". For a cafe: "latte art coffee cup on wooden table". Be concrete and unambiguous — avoid the brand name.'
    }
  },
  required: [
    'caption', 'hashtags', 'cta',
    'headlineMain', 'headlineAccent', 'subheadline',
    'tagline', 'features', 'offerText', 'ctaButtonLabel', 'photoKeywords'
  ]
};

async function generateAdContent(campaignInput) {
  const prompt = buildAdPrompt(campaignInput);

  const response = await axios.post(
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

  const modelOutputStep = response.data.steps.find(step => step.type === 'model_output');
  if (!modelOutputStep) {
    throw new Error('No model output returned from Gemini');
  }

  const textBlock = modelOutputStep.content.find(block => block.type === 'text');
  const parsed = JSON.parse(textBlock.text);

  return parsed; // { caption, hashtags, cta, headlineMain, headlineAccent, subheadline, tagline, features, offerText, ctaButtonLabel, photoKeywords }
}

module.exports = { generateAdContent };
