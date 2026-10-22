const jwt = require('jsonwebtoken');
const config = require('../config/env');
const postModel = require('../models/postModel');
const aiService = require('./aiService');
const imageService = require('./imageService');
const emailService = require('./emailService');

/**
 * Builds a signed, time-limited link for a specific post:
 *   approve -> approves it when clicked
 *   reject  -> rejects it (and regenerates the theme)
 *   edit    -> opens the edit page for it
 * This is what makes the email buttons work without logging in first.
 */
function buildEmailActionLink(postId, userId, action) {
  const token = jwt.sign({ postId, userId, action }, config.jwtSecret, { expiresIn: '7d' });
  if (action === 'edit') return `${config.appBaseUrl}/edit.html?token=${token}`;
  const path = action === 'approve' ? 'email-approve' : 'email-reject';
  return `${config.appBaseUrl}/api/posts/${path}?token=${token}`;
}

/**
 * Generates one post for a campaign, built around a specific theme.
 * Used both by the daily scheduler (first generation for a theme) and
 * by the reject-and-retry flow (regenerating a fresh take on the SAME
 * theme after the user rejects one). Does not touch the theme's
 * "used" flag — callers decide when to mark it used.
 */
async function generateThemedPost({ campaign, theme }) {
  const generated = await aiService.generateAdContent({
    productName: campaign.product_name,
    audience: campaign.audience,
    tone: campaign.tone,
    offerDetails: campaign.offer_details,
    theme: theme.theme_text
  });

  // The ad layout depends on how many posts are already published, so it
  // stays the same through reject/regenerate and changes after a post goes live.
  const postedCount = await postModel.countPostedPosts(campaign.id);
  const layoutIndex = postedCount % imageService.LAYOUT_COUNT;

  // The background photo is saved to disk under this name, so the text on
  // the image can be edited later without generating a new background.
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
    themeId: theme.id,
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

/** Emails the owner an Approve/Edit/Reject link set for a freshly generated post. */
async function emailForApproval({ campaign, userEmail, postId, generated, imageUrl }) {
  if (!userEmail) return false;

  const approveUrl = buildEmailActionLink(postId, campaign.user_id, 'approve');
  const rejectUrl = buildEmailActionLink(postId, campaign.user_id, 'reject');
  const editUrl = buildEmailActionLink(postId, campaign.user_id, 'edit');

  return emailService.sendApprovalEmail({
    toEmail: userEmail,
    productName: campaign.product_name,
    caption: generated.caption,
    hashtags: generated.hashtags,
    imageUrl,
    approveUrl,
    rejectUrl,
    editUrl
  });
}

module.exports = { generateThemedPost, emailForApproval, buildEmailActionLink };