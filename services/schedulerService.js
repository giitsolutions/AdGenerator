const scheduleStore = require('../models/scheduleStore');

const RETRY_DELAYS = [0, 5 * 60 * 1000, 10 * 60 * 1000];
const MAX_ATTEMPTS = 3;
const MAX_LATE_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 30 * 1000;

let running = false;
let intervalId = null;
let performApprovalFn = null;

function setPerformApproval(fn) {
  performApprovalFn = fn;
}

function shouldRetryNow(post) {
  const attempts = post.schedule_attempts || 0;
  if (attempts === 0) return true;
  if (attempts >= MAX_ATTEMPTS) return false;
  const delay = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)];
  const scheduled = new Date(post.scheduled_at).getTime();
  return Date.now() >= scheduled + delay;
}

async function processOne(post) {
  if (!performApprovalFn) {
    console.error('[schedulerService] performApproval not set');
    return;
  }
  if (!shouldRetryNow(post)) return;

  const claimed = await scheduleStore.markPublishing(post.id);
  if (!claimed) return;

  try {
    // ADJUST if your performApproval signature is different
    await performApprovalFn(post.id, post.user_id);
    console.log('[schedulerService] published scheduled post', post.id);
  } catch (err) {
    const msg = err.message || String(err);
    console.error('[schedulerService] publish failed for', post.id, msg);

    const attempts = (post.schedule_attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await scheduleStore.markFailed(post.id, msg);
      console.log('[schedulerService] post', post.id, 'marked failed after', attempts, 'attempts');
    } else {
      await scheduleStore.recordAttempt(post.id, msg);
      console.log('[schedulerService] will retry post', post.id, '(attempt', attempts, ')');
    }
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const expired = await scheduleStore.getExpiredScheduledPosts({ maxLateMs: MAX_LATE_MS });
    for (const p of expired) {
      await scheduleStore.markFailed(p.id, 'Scheduled time more than 6 hours ago');
      console.log('[schedulerService] expired post', p.id);
    }

    const due = await scheduleStore.getDueScheduledPosts({
      maxLateMs: MAX_LATE_MS,
      maxAttempts: MAX_ATTEMPTS
    });

    for (const post of due) {
      await processOne(post);
    }
  } catch (err) {
    console.error('[schedulerService] tick error:', err.message);
  } finally {
    running = false;
  }
}

function startAutoPoster() {
  if (intervalId) return;
  scheduleStore.ensureColumns().catch(() => {});
  setTimeout(() => tick().catch(() => {}), 4000);
  intervalId = setInterval(() => tick().catch(() => {}), TICK_MS);
  console.log('[schedulerService] Auto-poster started (every 30s)');
}

function stopAutoPoster() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  setPerformApproval,
  startAutoPoster,
  stopAutoPoster,
  tick
};