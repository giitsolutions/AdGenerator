/**
 * scripts/runDailyJob.js
 * Run the daily themed job once (for testing):
 *   node scripts/runDailyJob.js
 */

require('dotenv').config();

const { runDailyThemedJob } = require('../scheduler/scheduler');
const emailService = require('../services/emailService');
const config = require('../config/env');

(async () => {
  console.log('--- KwikPost daily job (manual run) ---');

  try {
    const mail = await emailService.verifyEmailSetup();
    if (mail.ok) {
      console.log(
        'Gmail OK — emails go to',
        config.notificationEmail || config.email?.user || '(check config)'
      );
    } else {
      console.warn('Gmail NOT OK:', mail.reason || mail.error || mail);
    }
  } catch (err) {
    console.warn('Could not verify email:', err.message);
  }

  try {
    const summary = await runDailyThemedJob();
    console.log('Result:', summary);
  } catch (err) {
    console.error('Job failed:', err);
    process.exitCode = 1;
  }

  process.exit();
})();