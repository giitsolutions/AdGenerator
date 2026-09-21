const campaignModel = require('../models/campaignModel');
const postModel = require('../models/postModel');
const themeModel = require('../models/themeModel');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');

async function createCampaign(req, res, next) {
  try {
    const campaignId = await campaignModel.createCampaign({ ...req.body, userId: req.userId });
    res.json({ campaignId });
  } catch (err) {
    next(err);
  }
}

async function listCampaigns(req, res, next) {
  try {
    const campaigns = await campaignModel.getAllCampaigns(req.userId);
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
}

async function generateForCampaign(req, res, next) {
  try {
    const campaign = await campaignModel.getCampaignById(req.params.id, req.userId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const generated = await aiService.generateAdContent({
      productName: campaign.product_name,
      audience: campaign.audience,
      tone: campaign.tone,
      offerDetails: campaign.offer_details
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
      userId: req.userId,
      campaignId: campaign.id,
      caption: generated.caption,
      hashtags: generated.hashtags,
      cta: generated.cta,
      imageUrl
    });

    res.json({ postId, ...generated, imageUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * Loads a batch of daily themes (e.g. 20, one per line) into a
 * campaign's queue. The daily scheduler consumes one per day, in
 * the order submitted, so this covers that many days unattended.
 */
async function setThemes(req, res, next) {
  try {
    const campaign = await campaignModel.getCampaignById(req.params.id, req.userId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { themes } = req.body; // expects a single string, one theme per line
    const themeLines = (themes || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (themeLines.length === 0) {
      return res.status(400).json({ error: 'Provide at least one theme, one per line' });
    }

    await themeModel.addThemes(campaign.id, req.userId, themeLines);
    res.json({ message: `${themeLines.length} theme(s) added to the queue` });
  } catch (err) {
    next(err);
  }
}

async function getThemes(req, res, next) {
  try {
    const themes = await themeModel.getThemesForCampaign(req.params.id, req.userId);
    const remaining = await themeModel.getRemainingCount(req.params.id);
    res.json({ themes, remaining });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCampaign, listCampaigns, generateForCampaign, setThemes, getThemes };
