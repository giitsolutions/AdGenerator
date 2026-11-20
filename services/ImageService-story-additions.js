// ======================================================================
// INSTAGRAM STORIES - paste this whole block into services/imageService.js,
// just above "module.exports = {", then add these two names to module.exports:
//     renderStoryImage,
//     generateAndHostStoryImage,
// It REPLACES the earlier renderStoryImage if you already pasted that one.
// ======================================================================

const STORY_W = 1080;
const STORY_H = 1920;
// Instagram covers about the top 250px (profile bar) and bottom 340px (reply bar) of a Story.
const STORY_SAFE_TOP = 250;
const STORY_SAFE_BOTTOM = 340;

async function loadImageFromUrl(url) {
  const value = String(url || '').trim();
  if (!value) throw new Error('No image to turn into a Story');
  if (/^https?:\/\//i.test(value)) {
    const res = await axios.get(value, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    return loadImage(Buffer.from(res.data));
  }
  const rel = value.replace(/^[\\/]+/, '').replace(/^public[\\/]/, '');
  const filePath = path.join(__dirname, '../public', rel);
  if (!fs.existsSync(filePath)) throw new Error('Local image not found: ' + filePath);
  return loadImage(fs.readFileSync(filePath));
}

// Any post image -> a tall Story picture (post centred over a blurred copy of itself).
// A picture that is already tall (a Story made on the Stories page) is sent as it is.
async function renderStoryImage(imageUrl) {
  const source = await loadImageFromUrl(imageUrl);

  if (source.height / source.width >= 1.7) {
    return ensurePublicImageUrl(imageUrl);
  }

  const canvas = createCanvas(STORY_W, STORY_H);
  const ctx = canvas.getContext('2d');

  // Blurred fill: shrink the picture and stretch it back up
  const tiny = createCanvas(27, 48);
  drawImageCover(tiny.getContext('2d'), source, 0, 0, 27, 48);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tiny, 0, 0, STORY_W, STORY_H);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const scale = Math.min(STORY_W / source.width, (STORY_H - 440) / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 30;
  ctx.drawImage(source, (STORY_W - w) / 2, (STORY_H - h) / 2, w, h);
  ctx.restore();

  return uploadImage(canvas.toBuffer('image/jpeg', { quality: 0.92 }));
}

// Draws a tall (1080x1920) Story: photo, headline, one-line description, offer pill, button.
// The text stays inside Instagram's safe zones.
async function generateStoryImage({
  productName, headlineMain, headlineAccent, subheadline,
  offerText, ctaButtonLabel, photo, logo
}) {
  const canvas = createCanvas(STORY_W, STORY_H);
  const ctx = canvas.getContext('2d');
  const accent = pickColor(productName);
  const accentText = mixWithWhite(accent);

  if (photo) {
    drawImageCover(ctx, photo, 0, 0, STORY_W, STORY_H);
  } else {
    const g = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
    g.addColorStop(0, accent);
    g.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }

  // Soft darkening at the top and the bottom so the text stays readable
  const top = ctx.createLinearGradient(0, 0, 0, 620);
  top.addColorStop(0, 'rgba(0,0,0,0.65)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, STORY_W, 620);
  const bottom = ctx.createLinearGradient(0, 900, 0, STORY_H);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.88)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 900, STORY_W, STORY_H - 900);

  // Stack the text from the bottom safe line upwards
  const pill = measurePill(ctx, offerText, 820, 30);
  const hl = fitHeadline(ctx, headlineMain, headlineAccent, true, 900, 100, 4, 56);
  const sub = layoutSubheadline(ctx, subheadline, 880);
  const ctaY = STORY_H - STORY_SAFE_BOTTOM - 52;
  const pillTop = ctaY - 34 - pill.h;
  const subTop = pillTop - 30 - sub.height;
  const hlTop = subTop - 18 - hl.height;

  ensureContrast(ctx, 0, hlTop - 20, STORY_W, (ctaY + 52) - hlTop + 40);

  drawBrand(ctx, productName, null, 66, STORY_SAFE_TOP + 36, 'left');
  drawHeadline(ctx, hl, 66, hlTop, 'left', accentText);
  drawSubheadline(ctx, sub, 66, subTop, 'left');
  if (pill.h) drawPill(ctx, pill, 66, pillTop, 'left');
  drawCtaPill(ctx, String(ctaButtonLabel || '').toUpperCase(), 66, ctaY, '#ffffff', accent, 'left');

  drawCornerLogo(ctx, STORY_W, logo, { logoY: STORY_SAFE_TOP });

  return canvas.toBuffer('image/jpeg', { quality: 0.93 });
}

// Makes a Story picture and returns its public URL.
async function generateAndHostStoryImage({
  productName, headlineMain, headlineAccent, subheadline,
  offerText, ctaButtonLabel, photoKeywords, logoUrl, photoBuffer
}) {
  const [photo, logo] = await Promise.all([
    photoBuffer
      ? loadImage(photoBuffer)
      : (photoKeywords ? fetchProductPhoto(photoKeywords) : null),
    fetchLogo(logoUrl)
  ]);
  const buffer = await generateStoryImage({
    productName, headlineMain, headlineAccent, subheadline,
    offerText, ctaButtonLabel, photo, logo
  });
  return uploadImage(buffer);
}