const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function resolveCampaignLogo(campaign, tmpDir) {
  const logoUrl = String(campaign.logo_url || '').trim();
  if (!logoUrl) return null;

  if (/^https?:\/\//i.test(logoUrl)) {
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      throw new Error(`Campaign logo could not be downloaded (HTTP ${response.status})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
      throw new Error('Campaign logo must be a non-empty image smaller than 10 MB');
    }
    const extension = path.extname(new URL(logoUrl).pathname) || '.img';
    const file = path.join(tmpDir, `logo${extension}`);
    fs.writeFileSync(file, bytes);
    return file;
  }

  const relativePath = decodeURIComponent(logoUrl.replace(/^[\\/]+/, ''));
  const file = [
    path.join(ROOT, relativePath),
    path.join(ROOT, 'public', relativePath)
  ].find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error('Campaign logo file could not be found');
  return file;
}

module.exports = { resolveCampaignLogo };
