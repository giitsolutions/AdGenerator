const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../config/env');
const campaignModel = require('../models/campaignModel');
const postModel = require('../models/postModel');
const themeModel = require('../models/themeModel');
const aiService = require('../services/aiService');
const postController = require('../controllers/postController');
const imageService = require('../services/imageService');
const themedPostService = require('../services/themedPostService');
const emailService = require('../services/emailService');

/**
 * Normalize timezone for node-cron / Intl.
 * Fixes common typos like "Asia/Kolkat" → "Asia/Kolkata".
 */
function resolveTimezone() {
  let tz =
    (config.scheduler && config.scheduler.timezone) ||
    process.env.SCHEDULER_TIMEZONE ||
    'Asia/Kolkata';

  tz = String(tz).trim();
  if (tz === 'Asia/Kolkat') tz = 'Asia/Kolkata';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch (_) {
    console.warn(
      `[scheduler] Invalid timezone "${tz}" — falling back to Asia/Kolkata`
    );
    return 'Asia/Kolkata';
  }
}

/**
 * Publish posts the user scheduled for a specific date/time.
 * Runs every minute via startScheduledPostRunner().
 * Publishing goes through performApproval, so image posts AND Reels
 * (media_type = 'reel') share one path, and a theme is marked used there.
 */
const MAX_LATE_HOURS = 24;
let scheduledRunnerBusy = false;

async function processDueScheduledPosts() {
  if (scheduledRunnerBusy) return;
  scheduledRunnerBusy = true;
  try {
    let due = [];
    try {
      due = await postModel.claimDueScheduledPosts(20);
    } catch (err) {
      console.error('[scheduler] Could not read due scheduled posts:', err.message);
      return;
    }
    if (!due.length) return;

    console.log(`[scheduler] ${due.length} scheduled post(s) due`);

    for (const post of due) {
      try {
        const lateHours = (Date.now() - new Date(post.scheduled_at).getTime()) / 3600000;
        if (lateHours > MAX_LATE_HOURS) {
          throw new Error(
            `Missed its scheduled time by ${Math.round(lateHours)} hours (the server was off). Press Retry if you still want to post it.`
          );
        }

        await postController.performApproval(post.id, post.user_id);
        console.log(`[scheduler] Scheduled post ${post.id} published for user ${post.user_id}`);
      } catch (err) {
        if (err.code === 'ALREADY_POSTED') continue;
        console.error(`[scheduler] Scheduled post ${post.id} failed:`, err.message);
        try {
          await postModel.markAsFailed(post.id, err.message);
        } catch (e) {
          console.error(`[scheduler] Could not save the failure of post ${post.id}:`, e.message);
        }
      }
    }
  } finally {
    scheduledRunnerBusy = false;
  }
}

function startScheduledPostRunner() {
  postModel
    .failStuckPublishingPosts()
    .then((n) => {
      if (n) {
        console.warn(
          `[scheduler] ${n} post(s) were cut off by a restart while publishing — marked failed, check Instagram then Retry.`
        );
      }
    })
    .catch((err) => console.error('[scheduler] Stuck-post check failed:', err.message));

  cron.schedule('* * * * *', () => {
    processDueScheduledPosts().catch((err) =>
      console.error('[scheduler] scheduled runner error:', err.message)
    );
  });

  setTimeout(() => {
    processDueScheduledPosts().catch(() => {});
  }, 8000);

  console.log('[scheduler] Scheduled post runner started (every 1 min)');
}

/**
 * True when this campaign must be skipped today:
 *  - a post is still waiting for approval (draft), or
 *  - a THEMED post is still pending (draft / scheduled / publishing). Its theme
 *    only becomes "used" when the post is published, so without this check the
 *    next day would generate the same theme again.
 */
async function campaignHasPendingPost(campaign) {
  if (typeof themedPostService.isCampaignBusy === 'function' &&
      themedPostService.isCampaignBusy(campaign.id)) return true;
  if (await postModel.hasPendingDraft(campaign.id)) return true;
  if (typeof postModel.hasPendingThemedPost === 'function' &&
      await postModel.hasPendingThemedPost(campaign.id)) return true;
  return false;
}

/**
 * DAILY job: one draft per campaign + email the CAMPAIGN USER only
 * (never config.notificationEmail / owner inbox).
 */
async function runDailyThemedJob() {
  console.log(`[scheduler] Daily job running at ${new Date().toISOString()}`);
  let campaigns = [];
  try {
    campaigns = await campaignModel.getAllCampaignsAcrossAllUsers();
  } catch (err) {
    console.error('[scheduler] Could not load campaigns:', err.message);
    return { created: 0, emailed: 0, skipped: 0, failed: 1 };
  }

  const summary = { created: 0, emailed: 0, skipped: 0, failed: 0 };

  for (const campaign of campaigns) {
    try {
      if (await campaignHasPendingPost(campaign)) {
        console.log(
          `[scheduler] Campaign ${campaign.id} still has a post waiting for approval — skipping.`
        );
        summary.skipped++;
        continue;
      }

      const nextTheme = await themeModel.getNextUnusedTheme(campaign.id);

      const run =
        typeof themedPostService.runExclusive === 'function'
          ? (id, fn) => themedPostService.runExclusive(id, fn)
          : (_id, fn) => fn();

      const sent = await run(campaign.id, async () => {
        const { postId, generated, imageUrl } = await themedPostService.generateThemedPost({
          campaign,
          theme: nextTheme || null
        });
        summary.created++;

        // USER email only — no fallback to notificationEmail / Anil
        let userEmail = null;
        if (typeof themedPostService.ownerEmailFor === 'function') {
          userEmail = await themedPostService.ownerEmailFor(campaign.user_id);
        }

        console.log(
          `[scheduler] campaign ${campaign.id} user_id=${campaign.user_id} email=${userEmail || '(none)'}`
        );

        if (!userEmail) {
          console.warn(
            `[scheduler] Campaign ${campaign.id}: user ${campaign.user_id} has no usable email — draft created, email skipped`
          );
          return false;
        }

        return themedPostService.emailForApproval({
          campaign,
          userEmail,
          postId,
          generated,
          imageUrl,
          theme: nextTheme || null
        });
      });

      if (sent) summary.emailed++;

      const label = nextTheme ? `theme: "${nextTheme.theme_text}"` : 'no theme queued';
      console.log(
        sent
          ? `[scheduler] Approval email sent for campaign ${campaign.id} (${label})`
          : `[scheduler] Draft created for campaign ${campaign.id}, but the email was NOT sent (no user email / Gmail issue)`
      );
    } catch (err) {
      summary.failed++;
      console.error(`[scheduler] Daily job failed for campaign ${campaign.id}:`, err.message);
    }
  }

  console.log(`[scheduler] Daily job finished:`, JSON.stringify(summary));
  return summary;
}

/**
 * OLD interval generator (every 6 hours, no pending-draft check). The daily
 * job replaces it, so it is OFF unless you set INTERVAL_SCHEDULER=true —
 * otherwise it would pile extra drafts on top of the daily one.
 */
function startIntervalScheduler() {
  if (process.env.INTERVAL_SCHEDULER !== 'true') {
    console.log('[scheduler] Interval scheduler is off (the daily job replaces it). Set INTERVAL_SCHEDULER=true to enable it.');
    return;
  }

  const cronExpression = config.scheduler.cronExpression;

  cron.schedule(cronExpression, async () => {
    console.log(`[scheduler] Running at ${new Date().toISOString()}`);
    const campaigns = await campaignModel.getAllCampaignsAcrossAllUsers();

    for (const campaign of campaigns) {
      try {
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
          await postModel.markReadyToPost(postId, campaign.user_id);
          await postModel.schedulePostAt(postId, campaign.user_id, new Date().toISOString());
          console.log(`[scheduler] Auto-approved and queued for campaign ${campaign.id} (user ${campaign.user_id})`);
        } else {
          console.log(
            `[scheduler] Draft created for campaign ${campaign.id} (user ${campaign.user_id}), awaiting approval`
          );
        }
      } catch (err) {
        console.error(`[scheduler] Failed for campaign ${campaign.id}:`, err.message);
      }
    }
  });

  console.log(`[scheduler] Interval scheduler started: ${cronExpression}`);
}

const LAST_RUN_FILE = path.join(__dirname, '../storage/last-daily-run.json');

function todayInTimezone() {
  const tz = resolveTimezone();
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

function nowMinutesInTimezone() {
  const tz = resolveTimezone();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function readLastRunDate() {
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8')).date || null;
  } catch (_) {
    return null;
  }
}

function writeLastRunDate() {
  try {
    fs.mkdirSync(path.dirname(LAST_RUN_FILE), { recursive: true });
    fs.writeFileSync(
      LAST_RUN_FILE,
      JSON.stringify({ date: todayInTimezone(), at: new Date().toISOString() })
    );
  } catch (err) {
    console.warn('[scheduler] Could not save last-run date:', err.message);
  }
}

let dailyJobRunning = false;

async function runAndRemember() {
  if (dailyJobRunning) {
    console.log('[scheduler] Daily job is already running — not starting a second one.');
    return null;
  }
  dailyJobRunning = true;
  try {
    const summary = await runDailyThemedJob();
    // A run that found no campaigns (created = 0, skipped = 0) is NOT remembered.
    if (summary && (summary.created > 0 || summary.skipped > 0)) writeLastRunDate();
    return summary;
  } finally {
    dailyJobRunning = false;
  }
}

function scheduledMinuteOfDay(expr) {
  const m = String(expr).trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  return m ? Number(m[2]) * 60 + Number(m[1]) : null;
}

/**
 * Startup report, ONE line:
 *   Status: N campaign(s), M unused theme(s), Gmail login OK, recipient: a@b.com
 */
async function printSchedulerStatus() {
  let campaigns = [];
  let themes = 0;
  const recipients = new Set();

  try {
    campaigns = await campaignModel.getAllCampaignsAcrossAllUsers();
    for (const c of campaigns) {
      try { themes += Number(await themeModel.getRemainingCount(c.id)) || 0; } catch (_) {}
    }
    if (typeof themedPostService.ownerEmailFor === 'function') {
      for (const userId of new Set(campaigns.map((c) => c.user_id))) {
        try {
          const email = await themedPostService.ownerEmailFor(userId);
          if (email) recipients.add(email);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[scheduler] Status check failed:', err.message);
  }

  const mail = await emailService.verifyEmailSetup();
  const gmail = mail.ok
    ? 'Gmail login OK'
    : `Gmail login FAILED (${mail.reason || mail.error})`;
  const to = recipients.size ? [...recipients].join(', ') : '(none — campaign users have no email on file)';

  console.log(
    `[scheduler] Status: ${campaigns.length} campaign(s), ${themes} unused theme(s), ${gmail}, recipient: ${to}`
  );
  if (!campaigns.length) {
    console.warn(
      '[scheduler] ⚠ No campaigns yet — create one in the app, otherwise the daily job has nothing to do.'
    );
  }
}

function startThemeScheduler() {
  const expr = config.scheduler.themeCronExpression;
  const timezone = resolveTimezone();

  if (!cron.validate(expr)) {
    console.error(`[scheduler] Invalid DAILY_JOB_CRON "${expr}" — daily job NOT scheduled.`);
    return;
  }

  cron.schedule(
    expr,
    () => {
      runAndRemember().catch((err) =>
        console.error('[scheduler] Daily job error:', err.message)
      );
    },
    { timezone }
  );
  console.log(
    `[scheduler] Daily job scheduled "${expr}" (${timezone}) — drafts a post and emails the campaign user for approval`
  );

  printSchedulerStatus().catch(() => {});

  const due = scheduledMinuteOfDay(expr);
  if (due !== null && nowMinutesInTimezone() >= due && readLastRunDate() !== todayInTimezone()) {
    console.log(
      "[scheduler] Today's run has not happened yet (server was off at the scheduled time) — running it now."
    );
    setTimeout(() => {
      runAndRemember().catch((err) =>
        console.error('[scheduler] Catch-up run error:', err.message)
      );
    }, 10000);
  }
}

module.exports = {
  runDailyThemedJob,
  startIntervalScheduler,
  startThemeScheduler,
  startScheduledPostRunner,
  processDueScheduledPosts
};