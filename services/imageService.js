const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');
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

// Backgrounds of generated drafts are kept on disk, so the text on a draft
// can be edited and re-drawn later without generating a new image.
const BACKGROUND_DIR = path.join(__dirname, '../storage/backgrounds');

function backgroundPath(filename) {
  return path.join(BACKGROUND_DIR, path.basename(String(filename)));
}

function hasBackground(filename) {
  return !!filename && fs.existsSync(backgroundPath(filename));
}

async function saveBackground(photo, filename) {
  fs.mkdirSync(BACKGROUND_DIR, { recursive: true });
  const c = createCanvas(1080, 1080);
  drawImageCover(c.getContext('2d'), photo, 0, 0, 1080, 1080);
  fs.writeFileSync(backgroundPath(filename), c.toBuffer('image/jpeg', { quality: 0.95 }));
}

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

// ---------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------
const DARK = '#161616';

// Lighter version of the brand colour, so accent-coloured TEXT and stripes
// stay readable on dark photos even when the brand colour is dark (navy etc).
function mixWithWhite(hex, amount = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.round(v + (255 - v) * amount);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// Fits the headline by shrinking the font (never by cutting words).
// twoTone: headlineMain in white, headlineAccent in the accent colour.
function fitHeadline(ctx, main, accentWords, twoTone, maxW, size, maxLines = 2, minSize = 42) {
  let s = size;
  for (;;) {
    ctx.font = `bold ${s}px ${FONT}`;
    let lines;
    if (twoTone) {
      const a = main ? wrapText(ctx, main, maxW) : [];
      const b = accentWords ? wrapText(ctx, accentWords, maxW) : [];
      lines = [...a.map(t => ({ text: t, accent: false })), ...b.map(t => ({ text: t, accent: true }))];
    } else {
      const text = `${main || ''} ${accentWords || ''}`.trim();
      lines = wrapText(ctx, text, maxW).map(t => ({ text: t, accent: false }));
    }
    if (lines.length <= maxLines || s <= minSize) {
      return { lines, size: s, lh: Math.round(s * 1.1), height: lines.length * Math.round(s * 1.1) };
    }
    s -= 4;
  }
}

function drawHeadline(ctx, h, x, top, align, accentColor) {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `bold ${h.size}px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 10;
  h.lines.forEach((ln, i) => {
    ctx.fillStyle = ln.accent && accentColor ? accentColor : '#ffffff';
    ctx.fillText(ln.text, x, top + Math.round(h.size * 0.82) + i * h.lh);
  });
  ctx.restore();
}

// The descriptive line under the headline ("what we actually sell").
function layoutSubheadline(ctx, text, maxWidth) {
  ctx.font = `26px ${FONT}`;
  const lines = text ? wrapText(ctx, text, maxWidth).slice(0, 3) : [];
  return { lines, height: lines.length * 34 };
}

function drawSubheadline(ctx, sub, x, y, align) {
  ctx.save();
  ctx.textAlign = align;
  ctx.font = `26px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  sub.lines.forEach((line, i) => ctx.fillText(line, x, y + 24 + i * 34));
  ctx.restore();
}

// The offer bar. The offer is NEVER reworded or cut off: long offers simply
// wrap onto more lines and the bar grows taller.
function measureBar(ctx, text, maxTextW, fs) {
  ctx.font = `bold ${fs}px ${FONT}`;
  const lines = text ? wrapText(ctx, text, maxTextW) : [];
  return { lines, fs, h: lines.length ? lines.length * (fs + 10) + 50 : 0 };
}

function drawBarLines(ctx, m, x, y, color, align) {
  ctx.save();
  ctx.font = `bold ${m.fs}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  m.lines.forEach((l, i) => ctx.fillText(l, x, y + 25 + m.fs + i * (m.fs + 10) - 4));
  ctx.restore();
}

// Compact offer pill: sized to the text, rounded ends, sober colours.
// Used by the layouts that used to have a full-width coloured offer bar.
// Change PILL_BG / PILL_FG to switch between white-on-black and black-on-white.
const PILL_BG = '#ffffff';
const PILL_FG = '#161616';

function measurePill(ctx, text, maxTextW, fs) {
  ctx.font = `bold ${fs}px ${FONT}`;
  const lines = text ? wrapText(ctx, text, maxTextW) : [];
  const tw = lines.length ? Math.max(...lines.map(l => ctx.measureText(l).width)) : 0;
  const lh = fs + 10;
  return { lines, fs, lh, w: Math.ceil(tw) + 64, h: lines.length ? lines.length * lh + 20 : 0 };
}

// align: 'center' (x = middle), 'left' (x = left edge) or 'right' (x = right edge)
function drawPill(ctx, m, x, y, align = 'center') {
  if (!m.h) return;
  const left = align === 'center' ? x - m.w / 2 : align === 'right' ? x - m.w : x;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = PILL_BG;
  roundedRectPath(ctx, left, y, m.w, m.h, Math.min(m.h / 2, 34));
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = PILL_FG;
  ctx.font = `bold ${m.fs}px ${FONT}`;
  ctx.textAlign = 'center';
  m.lines.forEach((l, i) => ctx.fillText(l, left + m.w / 2, y + 10 + i * m.lh + m.lh / 2 + m.fs * 0.35));
  ctx.restore();
}

function drawBrand(ctx, name, logo, x, y, align = 'left') {
  const label = String(name || '').toUpperCase();
  ctx.save();
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  if (align === 'center') {
    let ty = y;
    if (logo) { drawLogoCircle(ctx, logo, x, y - 34, 44); ty = y + 22; }
    ctx.textAlign = 'center';
    ctx.fillText(label, x, ty);
  } else {
    let tx = x;
    if (logo) { drawLogoCircle(ctx, logo, x + 22, y - 8, 44); tx = x + 58; }
    ctx.textAlign = 'left';
    ctx.fillText(label, tx, y);
  }
  ctx.restore();
}

function drawFrame(ctx, size, color, w = 28) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.strokeRect(w / 2, w / 2, size - w, size - w);
  ctx.restore();
}

function bottomScrim(ctx, size, fromY, alpha) {
  const g = ctx.createLinearGradient(0, fromY, 0, size);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

function topScrim(ctx, size, toY, alpha, fromY = 0) {
  const g = ctx.createLinearGradient(0, fromY, 0, toY);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, fromY, size, toY - fromY);
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
  const { fetchLocalSDPhoto } = require('./providers/localSDProvider');

  // First choice: generate a fresh image on the spot.
  const generated = await fetchLocalSDPhoto(photoKeywords);
  if (generated) return generated;

  // Fallback: stock photos never used before.
  const fresh = (await fetchStockPhoto(photoKeywords)) || (await fetchPexelsPhoto(photoKeywords));
  if (fresh) return fresh;

  console.log('[imageService] No unused photo matched — allowing a previously used one.');
  return (await fetchStockPhoto(photoKeywords, { allowReuse: true }))
    || (await fetchPexelsPhoto(photoKeywords, { allowReuse: true }));
}

const logoCache = new Map();

async function fetchLogo(logoUrl) {
  if (!logoUrl) return null;
  if (logoCache.has(logoUrl)) return logoCache.get(logoUrl);
  try {
    let raw;
    if (/^https?:\/\//i.test(logoUrl)) {
      const imageRes = await axios.get(logoUrl, { responseType: 'arraybuffer' });
      raw = Buffer.from(imageRes.data);
    } else {
      // Local file saved by the logo upload, e.g. /logos/logo-123.png
      const rel = logoUrl.replace(/^[\\/]+/, '');
      raw = fs.readFileSync(path.join(__dirname, '../public', rel));
    }
    let img;
    try {
      img = await loadImage(raw);
    } catch (e) {
      const sharp = require('sharp');
      const png = await sharp(raw).resize({ width: 400, height: 400, fit: 'inside' }).png().toBuffer();
      img = await loadImage(png);
    }
    logoCache.set(logoUrl, img);
    return img;
  } catch (err) {
    console.error('[imageService] Logo fetch failed, omitting logo:', err.message);
    return null;
  }
}

// Layout order matters: the layout used for a post is picked from the
// number of posts already published (see layoutIndex in generateAdImage).
// All layouts show: headline, descriptor line, offer (verbatim), CTA button.

// 0 — dark frame, offer pill on top, centred text
function renderDarkTopBar(ctx, size, accent, d) {
  bottomScrim(ctx, size, 380, 0.85);

  const pill = measurePill(ctx, d.offerText, 760, 28);
  const topH = pill.h ? pill.h + 40 : 0;
  topScrim(ctx, size, 28 + topH + 220, 0.75);
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 900, 76, 2, 46);
  const sub = layoutSubheadline(ctx, d.subheadline, 860);
  const ctaY = size - 28 - 40 - 52;
  const blockH = hl.height + 10 + sub.height;
  const top = ctaY - 28 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  drawPill(ctx, pill, size / 2, 48, 'center');
  d.logoY = 28 + topH + 24;
  drawBrand(ctx, d.productName, d.logo, size / 2, 28 + topH + 56, 'center');
  drawHeadline(ctx, hl, size / 2, top, 'center');
  drawSubheadline(ctx, sub, size / 2, top + hl.height + 10, 'center');
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size / 2, ctaY, '#ffffff', accent, 'center');
  drawFrame(ctx, size, DARK);
}

// 1 — white frame, accent stripe beside the headline, white offer bar at the bottom
function renderWhiteBarStripe(ctx, size, accent, d) {
  const W = size - 56;
  const accentText = mixWithWhite(accent);
  bottomScrim(ctx, size, 300, 0.8);
  topScrim(ctx, size, 260, 0.55);

  const bar = measureBar(ctx, d.offerText, W - 80, 30);
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 880, 70, 2, 44);
  const sub = layoutSubheadline(ctx, d.subheadline, 860);
  const barTop = size - 28 - bar.h;
  const blockH = hl.height + 8 + sub.height;
  const top = barTop - 40 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  drawBrand(ctx, d.productName, d.logo, 66, 96);
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size - 66 - (d.hasLogo ? LOGO_SIZE + 24 : 0), 64, accent, '#ffffff', 'right');

  ctx.fillStyle = accentText;
  ctx.fillRect(66, top, 10, blockH);
  drawHeadline(ctx, hl, 100, top, 'left');
  drawSubheadline(ctx, sub, 100, top + hl.height + 8, 'left');

  if (bar.h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(28, barTop, W, bar.h);
    drawBarLines(ctx, bar, size / 2, barTop, DARK, 'center');
  }
  drawFrame(ctx, size, '#ffffff');
}

// 2 — dark frame, WHITE offer bar on top, stripe headline bottom-left
function renderWhiteTopBar(ctx, size, accent, d) {
  const W = size - 56;
  const accentText = mixWithWhite(accent);
  bottomScrim(ctx, size, 380, 0.85);

  const bar = measureBar(ctx, d.offerText, W - 80, 28);
  topScrim(ctx, size, 28 + bar.h + 220, 0.75, 28 + bar.h);
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 880, 72, 2, 44);
  const sub = layoutSubheadline(ctx, d.subheadline, 860);
  const ctaY = size - 28 - 40 - 52;
  const blockH = hl.height + 8 + sub.height;
  const top = ctaY - 30 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  if (bar.h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(28, 28, W, bar.h);
    drawBarLines(ctx, bar, size / 2, 28, DARK, 'center');
  }
  d.logoY = 28 + bar.h + 24;
  drawBrand(ctx, d.productName, d.logo, 66, 28 + bar.h + 56);

  ctx.fillStyle = accentText;
  ctx.fillRect(66, top, 10, blockH);
  drawHeadline(ctx, hl, 100, top, 'left');
  drawSubheadline(ctx, sub, 100, top + hl.height + 8, 'left');
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), 100, ctaY, accent, '#ffffff', 'left');
  drawFrame(ctx, size, DARK);
}

// 3 — white frame, dark bottom bar: offer on the left, CTA button inside the bar on the right
function renderSplitBar(ctx, size, accent, d) {
  const W = size - 56;
  const accentText = mixWithWhite(accent);
  bottomScrim(ctx, size, 300, 0.8);
  topScrim(ctx, size, 260, 0.55);

  const bar = measureBar(ctx, d.offerText, 640, 26);
  const bh = Math.max(bar.h, 130);
  const barTop = size - 28 - bh;
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, true, 900, 76, 3, 48);
  const sub = layoutSubheadline(ctx, d.subheadline, 880);
  const blockH = hl.height + 14 + sub.height;
  const top = barTop - 40 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  drawBrand(ctx, d.productName, d.logo, 66, 96);
  drawHeadline(ctx, hl, 66, top, 'left', accentText);
  drawSubheadline(ctx, sub, 66, top + hl.height + 14, 'left');

  ctx.fillStyle = DARK;
  ctx.fillRect(28, barTop, W, bh);
  drawBarLines(ctx, bar, 66, barTop + (bh - bar.h) / 2, '#ffffff', 'left');
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size - 66, barTop + (bh - 52) / 2, accent, '#ffffff', 'right');
  drawFrame(ctx, size, '#ffffff');
}

// 4 — offer pill at the top left, big headline at the bottom
function renderRibbon(ctx, size, accent, d) {
  bottomScrim(ctx, size, 500, 0.8);
  topScrim(ctx, size, 420, 0.75);

  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 900, 76, 2, 46);
  const sub = layoutSubheadline(ctx, d.subheadline, 880);
  const ctaY = size - 28 - 40 - 52;
  const blockH = hl.height + 8 + sub.height;
  const top = ctaY - 30 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  drawBrand(ctx, d.productName, d.logo, 66, 96);
  drawPill(ctx, measurePill(ctx, d.offerText, 640, 26), 66, 130, 'left');

  drawHeadline(ctx, hl, 66, top, 'left');
  drawSubheadline(ctx, sub, 66, top + hl.height + 8, 'left');
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), 66, ctaY, '#ffffff', accent, 'left');
  drawFrame(ctx, size, '#ffffff');
}

// 5 — translucent dark card with the headline, offer pill at the bottom
function renderGlassCard(ctx, size, accent, d) {
  bottomScrim(ctx, size, 300, 0.5);
  topScrim(ctx, size, 260, 0.55);

  const pill = measurePill(ctx, d.offerText, 760, 28);
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 860, 68, 2, 44);
  const sub = layoutSubheadline(ctx, d.subheadline, 840);
  const barTop = size - 28 - (pill.h ? pill.h + 44 : 0);
  const cardH = 36 + hl.height + 10 + sub.height + 36;
  const cardTop = barTop - 24 - cardH;

  drawBrand(ctx, d.productName, d.logo, 66, 96);
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size - 66 - (d.hasLogo ? LOGO_SIZE + 24 : 0), 64, '#ffffff', accent, 'right');

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundedRectPath(ctx, 66, cardTop, size - 132, cardH, 28);
  ctx.fill();
  drawHeadline(ctx, hl, 106, cardTop + 36, 'left');
  drawSubheadline(ctx, sub, 106, cardTop + 36 + hl.height + 10, 'left');

  drawPill(ctx, pill, size / 2, barTop + 22, 'center');
  drawFrame(ctx, size, '#ffffff');
}

// 6 — double frame, centred, brand flourish at the top, offer pill at the bottom
function renderDoubleFrame(ctx, size, accent, d) {
  bottomScrim(ctx, size, 300, 0.85);
  topScrim(ctx, size, 260, 0.55);

  const pill = measurePill(ctx, d.offerText, 760, 28);
  const barTop = size - 28 - (pill.h ? pill.h + 44 : 0);
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, false, 880, 72, 2, 44);
  const sub = layoutSubheadline(ctx, d.subheadline, 820);
  const ctaY = barTop - 56 - 52;
  const blockH = hl.height + 8 + sub.height;
  const top = ctaY - 30 - blockH;

  ensureContrast(ctx, 60, top - 20, size - 120, blockH + 40);

  drawPill(ctx, pill, size / 2, barTop + 22, 'center');

  d.logoY = 78;
  d.logoRight = size - 78;
  const brandY = d.logo ? 134 : 110;
  drawBrand(ctx, d.productName, d.logo, size / 2, brandY, 'center');
  ctx.font = `bold 24px ${FONT}`;
  const bw = ctx.measureText(String(d.productName || '').toUpperCase()).width;
  const fy = (d.logo ? brandY + 22 : brandY) - 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.max(66, size / 2 - bw / 2 - 16 - 90), fy, 90, 2);
  ctx.fillRect(Math.min(size - 66 - 90, size / 2 + bw / 2 + 16), fy, 90, 2);

  drawHeadline(ctx, hl, size / 2, top, 'center');
  drawSubheadline(ctx, sub, size / 2, top + hl.height + 8, 'center');
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size / 2, ctaY, '#ffffff', accent, 'center');

  drawFrame(ctx, size, '#ffffff');
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(54, 54, size - 108, barTop - 80);
  ctx.restore();
}

// 7 — big stacked two-tone headline, white offer bar at the bottom, dark CTA at the top right
function renderStackedTwoTone(ctx, size, accent, d) {
  const W = size - 56;
  const accentText = mixWithWhite(accent);
  bottomScrim(ctx, size, 280, 0.8);
  topScrim(ctx, size, 260, 0.55);

  const bar = measureBar(ctx, d.offerText, W - 80, 30);
  const barTop = size - 28 - bar.h;
  const hl = fitHeadline(ctx, d.headlineMain, d.headlineAccent, true, 780, 92, 4, 54);
  const sub = layoutSubheadline(ctx, d.subheadline, 860);
  const blockH = hl.height + 10 + sub.height;
  const top = barTop - 40 - blockH;

  ensureContrast(ctx, 0, top - 20, size, blockH + 40);

  drawBrand(ctx, d.productName, d.logo, 66, 96);
  drawCtaPill(ctx, d.ctaButtonLabel.toUpperCase(), size - 66 - (d.hasLogo ? LOGO_SIZE + 24 : 0), 64, DARK, '#ffffff', 'right');

  ctx.fillStyle = accentText;
  ctx.fillRect(66, top, 10, blockH);
  drawHeadline(ctx, hl, 100, top, 'left', accentText);
  drawSubheadline(ctx, sub, 100, top + hl.height + 10, 'left');

  if (bar.h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(28, barTop, W, bar.h);
    drawBarLines(ctx, bar, size / 2, barTop, DARK, 'center');
  }
  drawFrame(ctx, size, '#ffffff');
}

// Big brand logo in the top-right corner (all layouts). Layouts may set
// d.logoY / d.logoRight to move it clear of their own bars and frames.
const LOGO_SIZE = 150;

function drawCornerLogo(ctx, size, logo, d) {
  if (!logo) return;
  const right = d.logoRight || size - 56;
  const y = d.logoY || 56;
  drawLogoCircle(ctx, logo, right - LOGO_SIZE / 2, y + LOGO_SIZE / 2, LOGO_SIZE);
}

const TEMPLATES = [
  renderDarkTopBar,
  renderWhiteBarStripe,
  renderWhiteTopBar,
  renderSplitBar,
  renderRibbon,
  renderGlassCard,
  renderDoubleFrame,
  renderStackedTwoTone
];

async function generateAdImage({
  productName, headlineMain, headlineAccent, subheadline,
  tagline, features, offerText, ctaButtonLabel, cta, photo, logo, layoutIndex
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

  // layoutIndex (e.g. number of posts already published) picks the layout, so
  // it only changes after a post goes live. No index given -> random.
  const n = TEMPLATES.length;
  const template = Number.isInteger(layoutIndex)
    ? TEMPLATES[((layoutIndex % n) + n) % n]
    : TEMPLATES[Math.floor(Math.random() * n)];
  // The logo is drawn big in the top-right corner after the layout (not next
  // to the brand name), so the layouts get logo: null and a hasLogo flag.
  const d = {
    productName, headlineMain, headlineAccent, subheadline,
    offerText, ctaButtonLabel, logo: null, hasLogo: !!logo
  };
  template(ctx, size, accent, d);
  drawCornerLogo(ctx, size, logo, d);

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

/**
 * Instagram / Make need a public https URL (not localhost / ngrok / relative).
 * Re-hosts via ImgBB → Imgur → Catbox when needed.
 */
async function ensurePublicImageUrl(imageUrl) {
  if (!imageUrl) throw new Error('No image URL to publish');

  const url = String(imageUrl).trim();
  const isHttp = /^https?:\/\//i.test(url);
  const isLocalHost = /localhost|127\.0\.0\.1/i.test(url);
  const isNgrok = /ngrok/i.test(url);
  const isRelative =
    url.startsWith('/') ||
    url.startsWith('uploads/') ||
    url.startsWith('public/');

  // Already a normal public host
  if (isHttp && !isLocalHost && !isNgrok) {
    return url;
  }

  let buffer;

  if (isRelative) {
    const rel = url.replace(/^[\\/]+/, '').replace(/^public[\\/]/, '');
    const filePath = path.join(__dirname, '../public', rel);
    if (!fs.existsSync(filePath)) {
      throw new Error('Local image not found: ' + filePath);
    }
    buffer = fs.readFileSync(filePath);
  } else if (isHttp) {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    buffer = Buffer.from(res.data);
  } else {
    throw new Error('Unsupported image URL for publish: ' + url);
  }

  const publicUrl = await uploadImage(buffer);
  console.log('[imageService] Re-hosted for Instagram:', publicUrl);
  return publicUrl;
}

async function generateAndHostAdImage({
  productName, headlineMain, headlineAccent, subheadline,
  tagline, features, offerText, ctaButtonLabel, cta, photoKeywords, logoUrl, layoutIndex, backgroundFile
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
  // Keep the background so the text can be edited later without a new image.
  if (photo && backgroundFile) {
    try {
      await saveBackground(photo, backgroundFile);
    } catch (err) {
      console.warn('[imageService] Could not save the background for editing:', err.message);
    }
  }
  const buffer = await generateAdImage({
    productName, headlineMain, headlineAccent, subheadline,
    tagline, features, offerText, ctaButtonLabel, cta, photo, logo, layoutIndex
  });
  const publicUrl = await uploadImage(buffer);
  return publicUrl;
}

// Re-draws a draft on its saved background with (possibly edited) text.
// Returns the JPEG buffer. Nothing is uploaded.
async function renderFromBackground({
  backgroundFile, productName, headlineMain, headlineAccent, subheadline,
  offerText, ctaButtonLabel, logoUrl, layoutIndex
}) {
  if (!hasBackground(backgroundFile)) throw new Error('No saved background for this post');
  const [photo, logo] = await Promise.all([
    loadImage(backgroundPath(backgroundFile)),
    fetchLogo(logoUrl)
  ]);
  return generateAdImage({
    productName, headlineMain, headlineAccent, subheadline,
    offerText, ctaButtonLabel: ctaButtonLabel || '', photo, logo, layoutIndex
  });
}

// Same as renderFromBackground, then uploads it. Returns the public URL.
async function renderAndHostFromBackground(params) {
  return uploadImage(await renderFromBackground(params));
}

// Generates a brand-new background for a draft and saves it over the old one.
async function createNewBackground({ photoKeywords, backgroundFile }) {
  const photo = await fetchProductPhoto(photoKeywords);
  if (!photo) throw new Error('No new background could be generated');
  await saveBackground(photo, backgroundFile);
}

module.exports = {
  generateAndHostAdImage,
  renderFromBackground,
  renderAndHostFromBackground,
  createNewBackground,
  hasBackground,
  ensurePublicImageUrl,
  uploadImage,
  LAYOUT_COUNT: TEMPLATES.length
};