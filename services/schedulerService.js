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

  const claimed = await scheduleStore.markPublishing(post.id, post.scheduled_at);
  if (!claimed) return;

  try {
    // ADJUST if your performApproval signature is different
    await performApprovalFn(post.id, post.user_id);
    console.log('[schedulerService] published scheduled post', post.id);
  } catch (err) {
    const msg = err.message || String(err);
    console.error('[schedulerService] publish failed for', post.id, msg);

    const attempts = (post.schedule_attempts || 0) + 1;
    await scheduleStore.recordAttempt(post.id, msg);
    if (attempts >= MAX_ATTEMPTS) {
      console.log('[schedulerService] post', post.id, 'remains scheduled after', attempts, 'attempts; manual retry is available');
    } else {
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
      const marked = await scheduleStore.markFailed(p.id, scheduleStore.EXPIRED_SCHEDULE_ERROR);
      if (marked) console.log('[schedulerService] expired post', p.id);
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
  scheduleStore.ensureColumns().catch(error =>
    console.error('[schedulerService] could not prepare scheduler columns:', error.message)
  );
  setTimeout(() => tick().catch(error =>
    console.error('[schedulerService] startup tick failed:', error.message)
  ), 4000);
  intervalId = setInterval(() => tick().catch(error =>
    console.error('[schedulerService] scheduled tick failed:', error.message)
  ), TICK_MS);
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
