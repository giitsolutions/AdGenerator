require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production. The built-in default is public in the GitHub repo.');
  }
  console.warn('[config] JWT_SECRET is not set in .env — using an insecure default. Fine for local testing only.');
}

if (isProduction && !process.env.APP_BASE_URL) {
  throw new Error('APP_BASE_URL must be set in production, otherwise email Approve/Reject links point to localhost.');
}

module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY
  },
  // Make.com is still used for image posts; Reels publish through Instagram Graph API.
  makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
  // Facebook app credentials power Instagram OAuth and direct Reel publishing.
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI,
    graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0'
  },
  reels: {
    maxFileSizeBytes: Math.max(1, Number(process.env.REEL_MAX_MB) || 100) * 1024 * 1024,
    maxDurationSeconds: Math.max(1, Number(process.env.REEL_MAX_SECONDS) || 90),
    pollIntervalMs: Math.max(1000, Number(process.env.REEL_POLL_INTERVAL_MS) || 5000),
    pollTimeoutMs: Math.max(10000, Number(process.env.REEL_POLL_TIMEOUT_MS) || 10 * 60 * 1000)
  },
  // imgbb free image hosting — used to publish our generated image
  // to a public URL that Instagram's API can fetch.
  imgbb: {
    apiKey: process.env.IMGBB_API_KEY
  },
  // Unsplash free API — ACTIVE provider (tried first). See
  // services/providers/unsplashPhotoProvider.js
  unsplash: {
    accessKey: process.env.UNSPLASH_ACCESS_KEY
  },
  // Pexels free API — ACTIVE provider (tried second, if Unsplash finds
  // nothing usable). See services/providers/pexelsPhotoProvider.js
  pexels: {
    apiKey: process.env.PEXELS_API_KEY
  },
  // Hugging Face free Serverless Inference API — ALTERNATE provider,
  // not currently used (free-tier image models were unreliable —
  // frequent 410 errors as models get deprecated from the free
  // router). Kept in services/imageService.js as generateImageWithHuggingFace()
  // in case Hugging Face's free tier stabilizes later.
  huggingface: {
    apiKey: process.env.HUGGINGFACE_API_KEY,
    model: process.env.HUGGINGFACE_MODEL || 'stabilityai/stable-diffusion-xl-base-1.0'
  },
  scheduler: {
    // Set SCHEDULER_ENABLED=false in .env to pause the old interval
    // scheduler below while testing.
    enabled: process.env.SCHEDULER_ENABLED !== 'true',
    cronExpression: process.env.POST_INTERVAL_CRON || '0 */6 * * *',
    // Daily job: one draft per campaign + approval email, every day at
    // 10:00 India time. (The old THEME_CRON setting was removed.)
    themeCronExpression: process.env.DAILY_JOB_CRON || '32 13 * * *',
    timezone: process.env.SCHEDULER_TIMEZONE || 'Asia/Kolkata',
  },
  // Free Gmail SMTP — YOUR OWN Gmail account sends the approval emails
  // (not each user's). Needs a Gmail "App Password", not your normal
  // password: https://myaccount.google.com/apppasswords
  email: {
    user: process.env.EMAIL_USER,
    appPassword: process.env.EMAIL_APP_PASSWORD
  },
    // Stable Diffusion server on the Mac mini (see services/providers/localSDProvider.js).
  // Leave LOCAL_SD_URL unset to skip it and use only Unsplash/Pexels.
  localSD: {
    url: process.env.LOCAL_SD_URL,
    apiKey: process.env.LOCAL_SD_KEY,
    // The defaults keep people out of the picture, because generated hands
    // come out distorted. Set either to empty for brands that need people.
    promptSuffix: process.env.LOCAL_SD_PROMPT_SUFFIX ?? ', professional photography, sharp focus, no people',
    negativePrompt: process.env.LOCAL_SD_NEGATIVE_PROMPT ?? 'people, person, human, hands, fingers, face, text, letters, watermark, logo',
        // Removes person words (athlete, lifting, hands...) from the description
    // before it goes to the image model. Set LOCAL_SD_STRIP_PEOPLE=false
    // for brands that need people in the photo.
    stripPeople: process.env.LOCAL_SD_STRIP_PEOPLE !== 'false',
    timeoutMs: 600000
  },
  // TEMPORARY (login disabled — see middleware/authMiddleware.js):
  // since there's no real logged-in user with their own email on file,
  // approval emails go here instead. Defaults to your sending Gmail
  // account if not set separately. Set NOTIFICATION_EMAIL explicitly
  // if you want approvals to go to a different inbox than the one
  // sending them.
  notificationEmail: process.env.NOTIFICATION_EMAIL || process.env.EMAIL_USER,
  // Used to build the Approve/Reject links inside approval emails.
  // Change to your real domain once deployed.
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5000'
};