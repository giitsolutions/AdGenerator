const axios = require('axios');
const config = require('../config/env');

/**
 * TEMPORARY: back to the Make.com webhook approach for now (direct
 * Instagram OAuth posting — see controllers/instagramAuthController.js
 * — is built and working, just not wired in currently). Sends the
 * approved post to a Make.com webhook, which holds the actual
 * Instagram connection and handles publishing on our behalf.
 */
async function publishToInstagram({ imageUrl, caption }) {
  if (!config.makeWebhookUrl) {
    throw new Error('MAKE_WEBHOOK_URL is not set in .env — add your Make.com webhook URL first.');
  }

  const response = await axios.post(config.makeWebhookUrl, {
    imageUrl,
    caption
  });

  return response.data;
}

module.exports = { publishToInstagram };
