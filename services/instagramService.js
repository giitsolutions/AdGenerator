const axios = require('axios');
const config = require('../config/env');
const { ensurePublicImageUrl } = require('./imageService');

async function publishToInstagram({ imageUrl, caption }) {
  const webhookUrl =
    (config.make && config.make.webhookUrl) ||
    process.env.MAKE_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error('Make.com webhook URL is not configured');
  }

  const publicImageUrl = await ensurePublicImageUrl(imageUrl);

  const payload = {
    imageUrl: publicImageUrl,
    image_url: publicImageUrl,
    caption: caption || ''
  };

  console.log('[instagram] Make imageUrl:', publicImageUrl);

  const response = await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 90000,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error('Make webhook HTTP ' + response.status + ': ' + JSON.stringify(response.data));
  }

  const data = response.data;
  if (data && (data.error || data.status === 'error')) {
    throw new Error(data.error || data.message || 'Make returned an error');
  }

  return { ok: true, publicImageUrl, makeResponse: data };
}

module.exports = { publishToInstagram };