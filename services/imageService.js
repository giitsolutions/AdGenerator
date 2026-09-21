const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config/env');

const { fetchStockPhoto } = require('./providers/unsplashPhotoProvider');
const { fetchPexelsPhoto } = require('./providers/pexelsPhotoProvider');

try {
  registerFont(path.join(__dirname, '../fonts/Poppins-Regular.ttf'), { family: 'Poppins', weight: 'normal', style: 'normal' });
  registerFont(path.join(__dirname, '../fonts/Poppins-Bold.ttf'), { family: 'Poppins', weight: 'bold', style: 'normal' });
  registerFont(path.join(__dirname, '../fonts/Poppins-Italic.ttf'), { family: 'Poppins', weight: 'normal', style: 'italic' });
} catch (err) {
  console.warn('[imageService] Poppins font files not found — using default Sans.');
}
const FONT = 'Poppins';

async function generateFullAdWithNanoBanana({
  productName, headlineMain, headlineAccent, subheadline,
  tagline, features, offerText, ctaButtonLabel, photoKeywords
}) {
  if (!config.gemini.apiKey) return null;

  const prompt = `
Create a polished, professional Instagram advertisement graphic, square format.
Scene: ${photoKeywords}.
Include these exact text elements, rendered clearly and legibly:
- Brand name at the top: "${productName}"
- Tagline beneath it: "${tagline}"
- Large bold headline: "${headlineMain} ${headlineAccent}"
- Supporting line: "${subheadline}"
- An eye-catching offer badge showing: "${offerText}"
- A button-style call to action reading: "${ctaButtonLabel}"
Style: clean minimal modern product-ad design, full-bleed photo with a soft
gradient scrim (not solid boxes), strong visual hierarchy, readable typography,
professional color grading, generous negative space, no clutter, no spelling errors.
`.trim();

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

  try {
    const response = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey } }
    );

    const parts = response.data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData || p.inline_data);
    const inline = imagePart?.inlineData || imagePart?.inline_data;

    if (!inline?.data) {
      console.warn('[imageService] Nano Banana returned no image data — falling back to photo+canvas pipeline.');
      return null;
    }

    console.log('[imageService] Full ad generated via Nano Banana (Gemini image model).');
    return Buffer.from(inline.data, 'base64');
  } catch (err) {
    const detail = err.response ? `status ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    console.warn('[imageService] Nano Banana unavailable, falling back to photo+canvas pipeline:', detail);
    return null;
  }
}

const PALETTE = ['#c1121f', '#1d3557', '#0f9b8e', '#7b2cbf', '#e07a1f', '#a4133c'];

function pickColor(seedText) {
  const sum = [...seedText].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return PALETTE[sum % PALETTE.length];
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const testLine = `${currentLine} ${words[i]}`;
    const { width } = ctx.measureText(testLine);
    if (width < maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }
  lines.push(currentLine);
  return lines;
}

function roundedRectPath(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function getRegionBrightness(ctx, x, y, w, h) {
  const safeX = Math.max(0, Math.floor(x));
  const safeY = Math.max(0, Math.floor(y));
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const imageData = ctx.getImageData(safeX, safeY, safeW, safeH);
  const data = imageData.data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 32) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  return count > 0 ? total / count : 128;
}

function ensureContrast(ctx, x, y, w, h) {
  const brightness = getRegionBrightness(ctx, x, y, w, h);
  if (brightness > 110) {
    const extraOpacity = Math.min(0.75, 0.35 + (brightness - 110) / 200);
    ctx.fillStyle = `rgba(0,0,0,${extraOpacity})`;
    roundedRectPath(ctx, x - 20, y - 20, w + 40, h + 40, 24);
    ctx.fill();
  }
}

function drawOfferTag(ctx, text, x, y, accent, align = 'left') {
  ctx.font = `bold 18px ${FONT}`;
  const w = ctx.measureText(text).width + 34;
  const drawX = align === 'left' ? x : x - w;
  ctx.fillStyle = accent;
  roundedRectPath(ctx, drawX, y, w, 38, 5);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(text, drawX + w / 2, y + 26);
  return w;
}

function drawCtaPill(ctx, text, x, y, bg, fg, align = 'left') {
  ctx.font = `bold 22px ${FONT}`;
  const w = ctx.measureText(text).width + 56;
  const drawX = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  ctx.fillStyle = bg;
  roundedRectPath(ctx, drawX, y, w, 52, 26);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.fillText(text, drawX + w / 2, y + 34);
  return w;
}

function drawImageCover(ctx, img, boxX, boxY, boxW, boxH) {
  const scale = Math.max(boxW / img.width, boxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = boxX + (boxW - w) / 2;
  const dy = boxY + (boxH - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
}

function drawLogoCircle(ctx, logo, cx, cy, logoSize) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, logoSize / 2 + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawImageCover(ctx, logo, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
  ctx.restore();
}

async function generateImageWithHuggingFace(prompt) {
  if (!config.huggingface.apiKey) return null;
  const url = `https://router.huggingface.co/hf-inference/models/${config.huggingface.model}`;
  const fullPrompt = `professional product photography, ${prompt}, studio lighting, high quality, realistic`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.post(url, { inputs: fullPrompt }, {
        headers: { Authorization: `Bearer ${config.huggingface.apiKey}` },
        responseType: 'arraybuffer'
      });
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const body = JSON.parse(Buffer.from(response.data).toString('utf-8'));
        const waitSeconds = Math.min(body.estimated_time || 15, 25);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        continue;
      }
      return await loadImage(Buffer.from(response.data));
    } catch (err) {
      return null;
    }
  }
  return null;
}

async function fetchProductPhoto(photoKeywords) {
  const fromUnsplash = await fetchStockPhoto(photoKeywords);
  if (fromUnsplash) return fromUnsplash;
  console.log('[imageService] No Unsplash match — trying Pexels instead.');
  return fetchPexelsPhoto(photoKeywords);
}

async function fetchLogo(logoUrl) {
  if (!logoUrl) return null;
  try {
    const imageRes = await axios.get(logoUrl, { responseType: 'arraybuffer' });
    return await loadImage(Buffer.from(imageRes.data));
  } catch (err) {
    console.error('[imageService] Logo fetch failed, omitting logo:', err.message);
    return null;
  }
}

function renderBottomTemplate(ctx, size, accent, data) {
  const { productName, headlineMain, headlineAccent, subheadline, offerText, ctaButtonLabel, logo } = data;

  const scrim = ctx.createLinearGradient(0, size * 0.35, 0, size);
  scrim.addColorStop(0, 'rgba(0,0,0,0)');
  scrim.addColorStop(0.5, 'rgba(0,0,0,0.4)');
  scrim.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, size, size);

  ctx.font = `bold 72px ${FONT}`;
  const headline = `${headlineMain} ${headlineAccent}`;
  const headlineLines = wrapText(ctx, headline, size - 100).slice(0, 2);
  const neededHeight = 115 + headlineLines.length * 78 + 36 + 40 + 52;
  const offerY = size - neededHeight - 20;

  ensureContrast(ctx, 0, offerY - 20, size, neededHeight + 40);

  if (logo) drawLogoCircle(ctx, logo, size - 55, 55, 50);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(productName.toUpperCase(), 50, 62);

  drawOfferTag(ctx, offerText.toUpperCase(), 50, offerY, accent);

  ctx.textAlign = 'left';
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  const headlineStartY = offerY + 115;
  headlineLines.forEach((line, i) => ctx.fillText(line, 50, headlineStartY + i * 78));
  ctx.shadowBlur = 0;

  ctx.textAlign = 'left';
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const subY = headlineStartY + headlineLines.length * 78 + 36;
  ctx.fillText(subheadline, 50, subY, size - 100);

  drawCtaPill(ctx, ctaButtonLabel.toUpperCase(), 50, subY + 40, '#ffffff', accent, 'left');
}

function renderTopTemplate(ctx, size, accent, data) {
  const { productName, headlineMain, headlineAccent, subheadline, offerText, ctaButtonLabel, logo } = data;

  const scrim = ctx.createLinearGradient(0, 0, 0, size * 0.6);
  scrim.addColorStop(0, 'rgba(0,0,0,0.8)');
  scrim.addColorStop(0.65, 'rgba(0,0,0,0.35)');
  scrim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, size, size);

  ensureContrast(ctx, 0, 0, size, 380);

  if (logo) drawLogoCircle(ctx, logo, size - 55, 55, 50);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(productName.toUpperCase(), 50, 58);

  drawOfferTag(ctx, offerText.toUpperCase(), 50, 88, accent);

  ctx.textAlign = 'left';
  ctx.font = `bold 66px ${FONT}`;
  const headline = `${headlineMain} ${headlineAccent}`;
  const headlineLines = wrapText(ctx, headline, size - 100).slice(0, 2);
  ctx.fillStyle = '#ffffff';
  const headlineStartY = 210;
  headlineLines.forEach((line, i) => ctx.fillText(line, 50, headlineStartY + i * 72));

  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const subY = headlineStartY + headlineLines.length * 72 + 36;
  ctx.fillText(subheadline, 50, subY, size - 100);

  drawCtaPill(ctx, ctaButtonLabel.toUpperCase(), 50, subY + 26, '#ffffff', accent, 'left');
}

function renderCenteredTemplate(ctx, size, accent, data) {
  const { productName, headlineMain, headlineAccent, subheadline, offerText, ctaButtonLabel, logo } = data;

  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0.25)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  ensureContrast(ctx, 60, size * 0.32, size - 120, size * 0.4);

  if (logo) drawLogoCircle(ctx, logo, size / 2, 55, 50);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(productName.toUpperCase(), size / 2, logo ? 110 : 62);

  ctx.font = `bold 64px ${FONT}`;
  const headline = `${headlineMain} ${headlineAccent}`;
  const headlineLines = wrapText(ctx, headline, size - 160).slice(0, 2);
  const startY = size / 2 - (headlineLines.length * 72) / 2;
  ctx.fillStyle = '#ffffff';
  headlineLines.forEach((line, i) => ctx.fillText(line, size / 2, startY + i * 72));

  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const subY = startY + headlineLines.length * 72 + 38;
  ctx.fillText(subheadline, size / 2, subY, size - 160);

  const tagY = subY + 26;
  ctx.font = `bold 18px ${FONT}`;
  const tagText = offerText.toUpperCase();
  const tagW = ctx.measureText(tagText).width + 34;
  ctx.fillStyle = accent;
  roundedRectPath(ctx, size / 2 - tagW / 2, tagY, tagW, 38, 19);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(tagText, size / 2, tagY + 26);

  drawCtaPill(ctx, ctaButtonLabel.toUpperCase(), size / 2, size - 110, '#ffffff', accent, 'center');
}

const TEMPLATES = [renderBottomTemplate, renderTopTemplate, renderCenteredTemplate];

async function generateAdImage({
  productName, headlineMain, headlineAccent, subheadline,
  tagline, features, offerText, ctaButtonLabel, cta, photo, logo
}) {
  const size = 1080;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const accent = pickColor(productName);

  if (photo) {
    drawImageCover(ctx, photo, 0, 0, size, size);
  } else {
    const fallbackGradient = ctx.createLinearGradient(0, 0, size, size);
    fallbackGradient.addColorStop(0, accent);
    fallbackGradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = fallbackGradient;
    ctx.fillRect(0, 0, size, size);
  }

  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  template(ctx, size, accent, {
    productName, headlineMain, headlineAccent, subheadline,
    offerText, ctaButtonLabel, logo
  });

  return canvas.toBuffer('image/jpeg', { quality: 0.93 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(uploadFn, imageBuffer, hostName, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await uploadFn(imageBuffer);
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[imageService] ${hostName} attempt ${i}/${attempts} failed, retrying in 2s...`);
        await sleep(2000);
      }
    }
  }
  throw lastErr;
}

async function uploadToImgbb(imageBuffer) {
  const form = new FormData();
  form.append('image', imageBuffer.toString('base64'));
  const response = await axios.post(
    `https://api.imgbb.com/1/upload?key=${config.imgbb.apiKey}`,
    form,
    { headers: form.getHeaders() }
  );
  return response.data.data.url;
}

async function uploadToImgur(imageBuffer) {
  if (!config.imgur.clientId) {
    throw new Error('IMGUR_CLIENT_ID is not set — cannot use Imgur fallback.');
  }
  const response = await axios.post(
    'https://api.imgur.com/3/image',
    { image: imageBuffer.toString('base64'), type: 'base64' },
    { headers: { Authorization: `Client-ID ${config.imgur.clientId}` } }
  );
  return response.data.data.link;
}

async function uploadToCatbox(imageBuffer) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', imageBuffer, { filename: 'ad.jpg', contentType: 'image/jpeg' });
  const response = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders()
  });
  const url = response.data?.trim();
  if (!url || !url.startsWith('http')) {
    throw new Error(`Catbox returned an unexpected response: ${url}`);
  }
  return url;
}

async function uploadImage(imageBuffer) {
  const hosts = [
    { name: 'imgbb', fn: uploadToImgbb },
    { name: 'Imgur', fn: uploadToImgur },
    { name: 'Catbox', fn: uploadToCatbox }
  ];

  let lastErr;
  for (const host of hosts) {
    try {
      return await withRetry(host.fn, imageBuffer, host.name);
    } catch (err) {
      lastErr = err;
      const detail = err.response ? `status ${err.response.status}` : err.message;
      console.warn(`[imageService] ${host.name} failed after retries (${detail}) — trying next host.`);
    }
  }

  throw new Error(`All image hosts failed. Last error: ${lastErr.message}`);
}

async function generateAndHostAdImage({
  productName, headlineMain, headlineAccent, subheadline,
  tagline, features, offerText, ctaButtonLabel, cta, photoKeywords, logoUrl
}) {
  const nanoBananaBuffer = await generateFullAdWithNanoBanana({
    productName, headlineMain, headlineAccent, subheadline,
    tagline, features, offerText, ctaButtonLabel, photoKeywords
  });
  if (nanoBananaBuffer) {
    return uploadImage(nanoBananaBuffer);
  }

  const [photo, logo] = await Promise.all([
    photoKeywords ? fetchProductPhoto(photoKeywords) : null,
    fetchLogo(logoUrl)
  ]);
  const buffer = await generateAdImage({
    productName, headlineMain, headlineAccent, subheadline,
    tagline, features, offerText, ctaButtonLabel, cta, photo, logo
  });
  const publicUrl = await uploadImage(buffer);
  return publicUrl;
}

module.exports = { generateAndHostAdImage };