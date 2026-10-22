// Generates a batch of background photos with the local Stable Diffusion server
// and saves them to storage/library/<BRAND>/ for later use.
// Run:  node scripts/generateLibrary.js
// Safe to stop and re-run: photos that already exist are skipped.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { fetchLocalSDPhoto } = require('../services/providers/localSDProvider');

// Folder name for this brand's photos
const BRAND = 'inhousegym';

// One photo per line. Tip: describe ONE object, close-up, blurred background,
// no people. That gives the cleanest results and avoids distorted equipment.
const PROMPTS = [
  'close-up of a black treadmill in a bright home, blurred background',
  'close-up of a pair of hex dumbbells on a wooden floor, blurred background',
  'close-up of a single adjustable dumbbell on a gym mat, blurred background',
  'close-up of a kettlebell on a clean concrete floor, blurred background',
  'close-up of a rolled yoga mat on a wooden floor, soft daylight, blurred background',
  'close-up of a stack of weight plates, blurred background',
  'close-up of a resistance band set laid on a mat, blurred background',
  'close-up of a foam roller on a clean floor, blurred background',
  'close-up of a black exercise bike in a bright room, blurred background',
  'close-up of a barbell resting on the floor, blurred background',
  'close-up of a row of dumbbells on a rack, shallow depth of field',
  'close-up of a pull-up bar mounted in a doorway, blurred background',
  'close-up of a stability ball in a bright room, blurred background',
  'close-up of a jump rope coiled on a wooden floor, blurred background',
  'close-up of a treadmill control display, blurred background',
  'close-up of a bench with a folded towel and water bottle, blurred background',
  'close-up of an elliptical machine in a bright room, blurred background',
  'close-up of a set of ankle weights on a mat, blurred background',
  'close-up of a gym towel and water bottle on a bench, blurred background',
  'close-up of a rowing machine in a bright room, blurred background'
];

const OUT_DIR = path.join(__dirname, '../storage/library', BRAND);
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const file = `${String(i + 1).padStart(2, '0')}-${slug(prompt)}.jpg`;
    const full = path.join(OUT_DIR, file);

    if (fs.existsSync(full)) {
      console.log(`[${i + 1}/${PROMPTS.length}] skipped (already exists): ${file}`);
      continue;
    }

    console.log(`[${i + 1}/${PROMPTS.length}] generating: ${prompt}`);
    try {
      const photo = await fetchLocalSDPhoto(prompt);
      if (!photo) throw new Error('image server returned nothing');

      // Crop to a 1080x1080 square
      const c = createCanvas(1080, 1080);
      const ctx = c.getContext('2d');
      const scale = Math.max(1080 / photo.width, 1080 / photo.height);
      const w = photo.width * scale, h = photo.height * scale;
      ctx.drawImage(photo, (1080 - w) / 2, (1080 - h) / 2, w, h);
      fs.writeFileSync(full, c.toBuffer('image/jpeg', { quality: 0.95 }));

      manifest.push({ file, tags: prompt });
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      console.log(`   saved ${file}`);
    } catch (err) {
      console.error(`   FAILED: ${err.message} (will be retried on the next run)`);
    }
  }
  console.log('Done. Photos are in', OUT_DIR);
}

main();