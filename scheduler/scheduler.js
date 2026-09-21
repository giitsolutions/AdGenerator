const cron = require('node-cron');
const config = require('../config/env');
const campaignModel = require('../models/campaignModel');
const postModel = require('../models/postModel');
const themeModel = require('../models/themeModel');
const aiService = require('../services/aiService');
const instagramService = require('../services/instagramService');
const imageService = require('../services/imageService');
const themedPostService = require('../services/themedPostService');

/**
 * DAILY job: for every campaign that has a pre-loaded theme queue,
 * pick the next unused theme (in order), generate a post built
 * around it, and email the owner an Approve/Reject link — no need
 * to open the dashboard at all for day-to-day approvals. Loading 20
 * themes once covers 20 days of this running unattended. If the
 * emailed post gets rejected, a fresh one is regenerated for the
 * SAME theme (see controllers/postController.js) rather than moving
 * on — so a theme only gets "used up" once you actually approve one.
 */
async function runDailyThemedJob() {
  console.log(`[scheduler] Daily themed job running at ${new Date().toISOString()}`);
  const campaigns = await campaignModel.getAllCampaignsAcrossAllUsers();

  for (const campaign of campaigns) {
    try {
      const nextTheme = await themeModel.getNextUnusedTheme(campaign.id);
      if (!nextTheme) continue; // no themes queued for this campaign — skip it

      const { postId, generated, imageUrl } = await themedPostService.generateThemedPost({
        campaign,
        theme: nextTheme
      });

      await themeModel.markThemeUsed(nextTheme.id);

      // TEMPORARY (login disabled): sends to config.notificationEmail
      // instead of a real per-user email, since there's no logged-in
      // account with its own email on file right now.
      const sent = await themedPostService.emailForApproval({
        campaign, userEmail: config.notificationEmail, postId, generated, imageUrl
      });
      console.log(sent
        ? `[scheduler] Approval email sent for campaign ${campaign.id} (theme: "${nextTheme.theme_text}")`
        : `[scheduler] Draft created for campaign ${campaign.id}, but EMAIL_USER/EMAIL_APP_PASSWORD not set — check dashboard instead`);
    } catch (err) {
      console.error(`[scheduler] Themed job failed for campaign ${campaign.id}:`, err.message);
    }
  }
}

function startIntervalScheduler() {
  const cronExpression = config.scheduler.cronExpression;

  cron.schedule(cronExpression, async () => {
    console.log(`[scheduler] Running at ${new Date().toISOString()}`);
    // Runs across ALL users' campaigns, since this is a background
    // job with no single logged-in user — each campaign still only
    // ever posts to ITS OWN owner's Instagram account.
    const campaigns = await campaignModel.getAllCampaignsAcrossAllUsers();

    for (const campaign of campaigns) {
      try {
        // Campaigns with a theme queue are handled exclusively by the
        // daily themed job below — skip them here to avoid generating
        // two posts for the same campaign on the same day.
        const remainingThemes = await themeModel.getRemainingCount(campaign.id);
        if (remainingThemes > 0) continue;

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
          userId: campaign.user_id,
          campaignId: campaign.id,
          caption: generated.caption,
          hashtags: generated.hashtags,
          cta: generated.cta,
          imageUrl
        });

        if (campaign.auto_approve) {
          const linkLine = campaign.website ? campaign.website : '🔗 Link in bio';
          const fullCaption = `${generated.caption}\n\n${generated.cta}\n\n${linkLine}\n\n${generated.hashtags.join(' ')}`;
          await instagramService.publishToInstagram({ imageUrl, caption: fullCaption });
          await postModel.markAsPosted(postId);
          console.log(`[scheduler] Auto-posted for campaign ${campaign.id} (user ${campaign.user_id})`);
        } else {
          console.log(`[scheduler] Draft created for campaign ${campaign.id} (user ${campaign.user_id}), awaiting approval`);
        }
      } catch (err) {
        console.error(`[scheduler] Failed for campaign ${campaign.id}:`, err.message);
      }
    }
  });

  console.log(`[scheduler] Interval scheduler started: ${cronExpression}`);
}

function startThemeScheduler() {
  cron.schedule(config.scheduler.themeCronExpression, runDailyThemedJob);
  console.log(`[scheduler] Daily themed job scheduled: ${config.scheduler.themeCronExpression}`);
}

module.exports = { startIntervalScheduler, startThemeScheduler };
