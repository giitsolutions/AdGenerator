const jwt = require('jsonwebtoken');
const config = require('../config/env');
const postModel = require('../models/postModel');
const aiService = require('./aiService');
const imageService = require('./imageService');
const emailService = require('./emailService');

/**
 * Builds a signed, time-limited link that approves/rejects a specific
 * post when clicked — this is what makes the email buttons work
 * without the user needing to log in first.
 */
function buildEmailActionLink(postId, userId, action) {
  const token = jwt.sign({ postId, userId, action }, config.jwtSecret, { expiresIn: '7d' });
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
    logoUrl: campaign.logo_url
  });

  const postId = await postModel.createPost({
    userId: campaign.user_id,
    campaignId: campaign.id,
    themeId: theme.id,
    caption: generated.caption,
    hashtags: generated.hashtags,
    cta: generated.cta,
    imageUrl
  });

  return { postId, generated, imageUrl };
}

/** Emails the owner an Approve/Reject link for a freshly generated post. */
async function emailForApproval({ campaign, userEmail, postId, generated, imageUrl }) {
  if (!userEmail) return false;

  const approveUrl = buildEmailActionLink(postId, campaign.user_id, 'approve');
  const rejectUrl = buildEmailActionLink(postId, campaign.user_id, 'reject');

  return emailService.sendApprovalEmail({
    toEmail: userEmail,
    productName: campaign.product_name,
    caption: generated.caption,
    hashtags: generated.hashtags,
    imageUrl,
    approveUrl,
    rejectUrl
  });
}

module.exports = { generateThemedPost, emailForApproval, buildEmailActionLink };
