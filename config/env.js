require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET is not set in .env — using an insecure default. Set a real secret before any real use.');
}

module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY
  },
  // TEMPORARY: back to Make.com for posting (see services/instagramService.js).
  makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
  // ONE Facebook Developer app — NOT currently used (direct Instagram
  // OAuth is built in controllers/instagramAuthController.js but
  // unwired for now, in favor of the Make.com webhook above). Kept
  // here so switching back later doesn't require re-adding this.
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI
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
    // Set SCHEDULER_ENABLED=false in .env to pause all automatic post
    // generation while testing — useful so campaigns you're just
    // experimenting with don't quietly rack up unwanted drafts.
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
    cronExpression: process.env.POST_INTERVAL_CRON || '0 */6 * * *',
    // Separate daily job specifically for the theme queue — one theme
    // used per day, independent of the general interval scheduler above.
    themeCronExpression: process.env.THEME_CRON || '0 9 * * *' // default: 9am daily
  },
  // Free Gmail SMTP — YOUR OWN Gmail account sends the approval emails
  // (not each user's). Needs a Gmail "App Password", not your normal
  // password: https://myaccount.google.com/apppasswords
  email: {
    user: process.env.EMAIL_USER,
    appPassword: process.env.EMAIL_APP_PASSWORD
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
