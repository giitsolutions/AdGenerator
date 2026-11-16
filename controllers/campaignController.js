const campaignModel = require('../models/campaignModel');
const postModel = require('../models/postModel');
const themeModel = require('../models/themeModel');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');
const libraryPhotoService = require('../services/libraryPhotoService');

async function createCampaign(req, res, next) {
  try {
    const body = req.body || {};
    const productName = body.productName || body.product_name;
    if (!productName) {
      return res.status(400).json({ error: 'Product/Service name is required' });
    }

    const campaignId = await campaignModel.createCampaign({
      userId: req.userId,
      productName,
      audience: body.audience || '',
      tone: body.tone || '',
      offerDetails: body.offerDetails || body.offer_details || '',
      website: body.website || '',
      logoUrl: body.logoUrl || body.logo_url || '',
      contactEmail: body.contactEmail || body.contact_email || '',
      whatsappNumber: body.whatsappNumber || body.whatsapp_number || '',
      intervalCron: body.intervalCron || body.interval_cron,
      autoApprove: body.autoApprove || body.auto_approve,
      defaultImageUrl: body.defaultImageUrl || body.default_image_url
    });

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

    const ctaLabel = generated.ctaButtonLabel || generated.cta || 'Learn more';

    // Random layout every generate (one of the 8 templates)
    const layoutIndex = Math.floor(Math.random() * (imageService.LAYOUT_COUNT || 8));

    const chosenId = req.body && req.body.libraryImageId ? Number(req.body.libraryImageId) : null;
    const libraryPhoto = await libraryPhotoService.pickLibraryPhoto(req.userId, chosenId);
    const backgroundFile = libraryPhotoService.newBackgroundFile();

    const imageUrl = await imageService.generateAndHostAdImage({
      productName: campaign.product_name,
      headlineMain: generated.headlineMain,
      headlineAccent: generated.headlineAccent,
      subheadline: generated.subheadline,
      tagline: generated.tagline,
      features: generated.features,
      offerText: generated.offerText,
      ctaButtonLabel: ctaLabel,
      cta: generated.cta,
      photoKeywords: generated.photoKeywords,
      logoUrl: campaign.logo_url,
      layoutIndex,
      backgroundFile,
      photoBuffer: libraryPhoto ? libraryPhoto.buffer : undefined
    });

    const savedBackground = imageService.hasBackground(backgroundFile) ? backgroundFile : null;

    const postId = await postModel.createPost({
      userId: req.userId,
      campaignId: campaign.id,
      caption: generated.caption,
      hashtags: generated.hashtags,
      cta: generated.cta,
      imageUrl,
      headlineMain: generated.headlineMain,
      headlineAccent: generated.headlineAccent,
      subheadline: generated.subheadline,
      offerText: generated.offerText,
      ctaLabel,
      tagline: generated.tagline,
      backgroundFile: savedBackground,
      layoutIndex
    });

    res.json({ postId, ...generated, ctaButtonLabel: ctaLabel, imageUrl, layoutIndex });
  } catch (err) {
    next(err);
  }
}

async function setThemes(req, res, next) {
  try {
    const campaign = await campaignModel.getCampaignById(req.params.id, req.userId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const raw = req.body.themes;
    let themeLines = [];

    if (Array.isArray(raw)) {
      themeLines = raw.map((line) => String(line).trim()).filter((line) => line.length > 0);
    } else {
      themeLines = String(raw || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

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

function sent(...values) {
  return values.find((v) => v !== undefined);
}

async function updateCampaign(req, res, next) {
  try {
    const id = req.params.id;
    const body = req.body || {};

    const productName = body.productName || body.product_name;
    if (!productName) {
      return res.status(400).json({ error: 'Product/Service name is required' });
    }

    const existing = await campaignModel.getCampaignById(id, req.userId);
    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const changes = await campaignModel.updateCampaign(id, req.userId, {
      productName,
      audience: body.audience || '',
      tone: body.tone || '',
      offerDetails: body.offerDetails || body.offer_details || '',
      website: body.website || '',
      logoUrl: sent(body.logoUrl, body.logo_url, existing.logo_url) || '',
      contactEmail: sent(body.contactEmail, body.contact_email, existing.contact_email) || '',
      whatsappNumber: sent(body.whatsappNumber, body.whatsapp_number, existing.whatsapp_number) || ''
    });

    if (!changes) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ message: 'Campaign updated' });
  } catch (err) {
    next(err);
  }
}

async function deleteCampaign(req, res, next) {
  try {
    const id = req.params.id;
    const changes = await campaignModel.deleteCampaign(id, req.userId);

    if (!changes) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCampaign,
  listCampaigns,
  generateForCampaign,
  setThemes,
  getThemes,
  updateCampaign,
  deleteCampaign
};