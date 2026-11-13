const jwt = require('jsonwebtoken');
const config = require('../config/env');
const postModel = require('../models/postModel');
const aiService = require('./aiService');
const imageService = require('./imageService');
const emailService = require('./emailService');
const { q } = require('../db/query');
const { findThemeMeta } = require('../db/migrations');

/**
 * In-memory lock so the same campaign is not processed twice at once
 * (daily job + reject-regenerate overlapping).
 */
const busyCampaigns = new Set();

function isCampaignBusy(campaignId) {
  return busyCampaigns.has(String(campaignId));
}

async function runExclusive(campaignId, fn) {
  const key = String(campaignId);
  if (busyCampaigns.has(key)) {
    throw new Error('Campaign is already being processed');
  }
  busyCampaigns.add(key);
  try {
    return await fn();
  } finally {
    busyCampaigns.delete(key);
  }
}

/**
 * Builds a signed, time-limited link for a specific post:
 *   approve -> approves it when clicked
 *   reject  -> rejects it (and regenerates the theme)
 *   edit    -> opens the edit page for it
 */
function buildEmailActionLink(postId, userId, action) {
  const token = jwt.sign({ postId, userId, action }, config.jwtSecret, { expiresIn: '7d' });
  if (action === 'edit') return `${config.appBaseUrl}/edit.html?token=${token}`;
  const path = action === 'approve' ? 'email-approve' : 'email-reject';
  return `${config.appBaseUrl}/api/posts/${path}?token=${token}`;
}

/**
 * Generates one post for a campaign.
 * Theme is only marked used on APPROVE (performApproval), not here.
 */
async function generateThemedPost({ campaign, theme }) {
  const generated = await aiService.generateAdContent({
    productName: campaign.product_name,
    audience: campaign.audience,
    tone: campaign.tone,
    offerDetails: campaign.offer_details,
    theme: theme ? theme.theme_text : ''
  });

  const postedCount = await postModel.countPostedPosts(campaign.id);
  const layoutIndex = postedCount % imageService.LAYOUT_COUNT;

  const backgroundFile = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const imageUrl = await imageService.generateAndHostAdImage({
    productName: campaign.product_name,
    headlineMain: generated.headlineMain,
    headlineAccent: generated.headlineAccent,
    subheadline: generated.subheadline,
    tagline: generated.tagline,
    features: generated.features,
    offerText: generated.offerText,
    ctaButtonLabel: generated.ctaButtonLabel,
    cta: generated.cta,
    photoKeywords: generated.photoKeywords,
    logoUrl: campaign.logo_url,
    layoutIndex,
    backgroundFile
  });

  const postId = await postModel.createPost({
    userId: campaign.user_id,
    campaignId: campaign.id,
    themeId: theme ? theme.id : null,
    caption: generated.caption,
    hashtags: generated.hashtags,
    cta: generated.cta,
    imageUrl,
    headlineMain: generated.headlineMain,
    headlineAccent: generated.headlineAccent,
    subheadline: generated.subheadline,
    offerText: generated.offerText,
    ctaLabel: generated.ctaButtonLabel,
    photoKeywords: generated.photoKeywords,
    backgroundFile: imageService.hasBackground(backgroundFile) ? backgroundFile : null,
    layoutIndex
  });

  return { postId, generated, imageUrl };
}

/**
 * Email for the campaign USER (users.email).
 * Does not fall back to notificationEmail for normal accounts.
 * Returns null if the user has no usable email.
 */
async function ownerEmailFor(userId) {
  if (userId == null) return null;

  // 1) Prefer userModel if you have it
  try {
    const userModel = require('../models/userModel');
    if (typeof userModel.findById === 'function') {
      const u = await userModel.findById(userId);
      if (u && u.email) {
        const email = String(u.email).trim();
        if (!/@(localhost|local|example\.com)$/i.test(email)) return email;
      }
    }
    if (typeof userModel.getById === 'function') {
      const u = await userModel.getById(userId);
      if (u && u.email) {
        const email = String(u.email).trim();
        if (!/@(localhost|local|example\.com)$/i.test(email)) return email;
      }
    }
  } catch (_) {}

  // 2) Direct SQL via getDb (same as clearDrafts)
  try {
    const { getDb } = require('../db/connection');
    const db = await getDb();
    let row;
    if (typeof db.get === 'function') {
      row = await db.get('SELECT email FROM users WHERE id = ?', [userId]);
    } else if (typeof db.prepare === 'function') {
      row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    }
    if (row && row.email) {
      const email = String(row.email).trim();
      if (!/@(localhost|local|example\.com)$/i.test(email)) return email;
      console.warn('[themedPostService] unusable email for user', userId, email);
    }
  } catch (err) {
    console.warn('[themedPostService] ownerEmailFor failed:', err.message);
  }

  return null;
}

/**
 * Emails the campaign user Approve / Edit / Reject links.
 */
async function emailForApproval({ campaign, userEmail, postId, generated, imageUrl, theme }) {
  const to = userEmail || (await ownerEmailFor(campaign.user_id));

  console.log(
    '[themedPostService] emailForApproval campaign=',
    campaign.id,
    'user_id=',
    campaign.user_id,
    'to=',
    to
  );

  if (!to) {
    console.warn(
      '[themedPostService] No usable email for user',
      campaign.user_id,
      '— skip send (set a real email on that user)'
    );
    return false;
  }

  const links = {
    approve: buildEmailActionLink(postId, campaign.user_id, 'approve'),
    reject: buildEmailActionLink(postId, campaign.user_id, 'reject'),
    edit: buildEmailActionLink(postId, campaign.user_id, 'edit')
  };

  const tags = Array.isArray(generated.hashtags)
    ? generated.hashtags.join(' ')
    : generated.hashtags || '';
  const caption = [generated.caption, tags].filter(Boolean).join('\n\n');

  try {
    await emailService.sendApprovalEmail({
      to,
      campaignName: campaign.product_name || 'campaign',
      themeLabel: theme ? theme.theme_text : null,
      caption,
      imageUrl,
      links
    });
    return true;
  } catch (err) {
    console.error('[themedPostService] sendApprovalEmail failed:', err.message);
    return false;
  }
}

/* ---------------- theme queue helpers ---------------- */

function shapeTheme(meta, row) {
  return row ? { ...row, theme_text: String(row[meta.labelCol] ?? '') } : null;
}

async function getNextUnusedTheme(campaignId) {
  const meta = await findThemeMeta(q());
  if (!meta) return null;
  const row = await q().get(
    `SELECT * FROM ${meta.table} WHERE campaign_id = ? AND (${meta.usedCol} IS NULL OR ${meta.usedCol} = 0)
     ORDER BY ${meta.orderCol} ASC, id ASC LIMIT 1`,
    [campaignId]
  );
  return shapeTheme(meta, row);
}

async function getThemeById(themeId) {
  const meta = await findThemeMeta(q());
  if (!meta || !themeId) return null;
  return shapeTheme(meta, await q().get(`SELECT * FROM ${meta.table} WHERE id = ?`, [themeId]));
}

async function countUnusedThemes() {
  const meta = await findThemeMeta(q());
  if (!meta) return 0;
  const r = await q().get(
    `SELECT COUNT(*) AS n FROM ${meta.table} WHERE ${meta.usedCol} IS NULL OR ${meta.usedCol} = 0`
  );
  return Number(r.n || 0);
}

async function markThemeUsed(themeId) {
  const meta = await findThemeMeta(q());
  if (!meta || !themeId) return;
  await q().run(`UPDATE ${meta.table} SET ${meta.usedCol} = 1 WHERE id = ?`, [themeId]);
}

module.exports = {
  generateThemedPost,
  emailForApproval,
  buildEmailActionLink,
  ownerEmailFor,
  getNextUnusedTheme,
  getThemeById,
  countUnusedThemes,
  markThemeUsed,
  isCampaignBusy,
  runExclusive
};