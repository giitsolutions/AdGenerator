// services/slideshowReelService.js
// Reel made from the user's own photo library: photos with a slow zoom,
// plus the logo / brand / caption / offer overlay.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderReelOverlay } = require('./reelOverlay');
const { composeFromPhotos } = require('./reelRender');

async function generateSlideshowReel({ photos, headline, headlineAccent, subheadline, offer, cta, logoPath, brand, caption, duration, outPath, sourceOutPath }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-ov-'));
  try {
    if (sourceOutPath) {
      await composeFromPhotos({ photos, duration, outPath: sourceOutPath });
    }
    const overlayPath = path.join(tmp, 'overlay.png');
    fs.writeFileSync(overlayPath, await renderReelOverlay({
      logoPath, brand: brand || headline, headline, headlineAccent, subheadline,
      caption: caption || '', offer, cta
    }));
    await composeFromPhotos({ photos, overlayPath, duration, outPath });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { generateSlideshowReel };