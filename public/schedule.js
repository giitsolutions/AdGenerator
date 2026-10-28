/**
 * schedule.js
 * Schedule popup + helper functions for the KwikPost dashboard.
 *
 * Include BEFORE app.js:
 *   <script src="schedule.js"></script>
 *   <script src="app.js"></script>
 *
 * On each post card (draft / failed) add:
 *   <button onclick="schedulePost(POST_ID)">Schedule</button>
 *   <button onclick="unschedulePost(POST_ID)" style="display:none" class="unschedule-btn">Cancel schedule</button>
 *   <button onclick="retryScheduledPost(POST_ID)" style="display:none" class="retry-btn">Retry</button>
 *   <span class="sched-label"></span>
 */

(function () {
  'use strict';

  // ── auth header (same places app.js usually stores the token) ────────────
  function authHeaders() {
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('jwt') ||
      localStorage.getItem('authToken') ||
      localStorage.getItem('accessToken') ||
      sessionStorage.getItem('token');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  function afterChange() {
    if (typeof window.loadPosts === 'function') {
      window.loadPosts();
    } else if (typeof window.refreshPosts === 'function') {
      window.refreshPosts();
    } else {
      // last resort
      setTimeout(() => location.reload(), 600);
    }
  }

  // ── public helpers used by the popup and cards ───────────────────────────
  window.formatScheduled = function (iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (_) {
      return iso;
    }
  };

  window.schedulePost = function (postId) {
    openSchedulePopup(postId);
  };

  window.unschedulePost = async function (postId) {
    if (!confirm('Cancel the scheduled publish?')) return;
    try {
      await api('/api/posts/' + postId + '/unschedule', { method: 'POST', body: '{}' });
      toast('Schedule cancelled');
      afterChange();
    } catch (e) {
      alert(e.message);
    }
  };

  window.retryScheduledPost = async function (postId) {
    try {
      await api('/api/posts/' + postId + '/retry', { method: 'POST', body: '{}' });
      toast('Queued for retry in ~1 minute');
      afterChange();
    } catch (e) {
      alert(e.message);
    }
  };

  // ── quick-pick helpers ───────────────────────────────────────────────────
  function atLocal(hours, minutes, dayOffset) {
    const d = new Date();
    d.setDate(d.getDate() + (dayOffset || 0));
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  function toDatetimeLocalValue(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      'T' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    );
  }

  // ── popup UI ─────────────────────────────────────────────────────────────
  let popupEl = null;
  let currentPostId = null;

  function ensurePopup() {
    if (popupEl) return popupEl;

    popupEl = document.createElement('div');
    popupEl.id = 'kwik-schedule-popup';
    popupEl.innerHTML = `
      <div class="kwik-sched-backdrop"></div>
      <div class="kwik-sched-card">
        <h3>Schedule post</h3>
        <p class="kwik-sched-sub">Pick a date & time. The post will auto-publish to Instagram then.</p>

        <label>Date & time</label>
        <input type="datetime-local" id="kwik-sched-input" />

        <div class="kwik-sched-picks">
          <button type="button" data-pick="today-1930">Today 7:30 PM</button>
          <button type="button" data-pick="tomorrow-0900">Tomorrow 9:00 AM</button>
          <button type="button" data-pick="tomorrow-2015">Tomorrow 8:15 PM</button>
        </div>

        <div class="kwik-sched-actions">
          <button type="button" class="kwik-sched-cancel">Cancel</button>
          <button type="button" class="kwik-sched-confirm">Schedule</button>
        </div>
      </div>
    `;

    // styles
    const style = document.createElement('style');
    style.textContent = `
      #kwik-schedule-popup { position:fixed; inset:0; z-index:9999; display:none; align-items:center; justify-content:center; font-family:system-ui,sans-serif; }
      #kwik-schedule-popup.open { display:flex; }
      .kwik-sched-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.55); }
      .kwik-sched-card { position:relative; background:#1a1824; color:#f5f2fb; border:1px solid #2a2634; border-radius:16px; padding:22px; width:min(360px,92vw); box-shadow:0 20px 50px rgba(0,0,0,.4); }
      .kwik-sched-card h3 { margin:0 0 6px; font-size:18px; }
      .kwik-sched-sub { margin:0 0 14px; color:#a39bbd; font-size:13px; }
      .kwik-sched-card label { display:block; font-size:12px; color:#a39bbd; margin-bottom:4px; }
      #kwik-sched-input { width:100%; box-sizing:border-box; background:#0f0e15; color:#f5f2fb; border:1px solid #2a2634; border-radius:10px; padding:10px 12px; font-size:14px; margin-bottom:12px; }
      .kwik-sched-picks { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
      .kwik-sched-picks button { background:#17151f; color:#a39bbd; border:1px solid #2a2634; border-radius:99px; padding:6px 12px; font-size:12px; cursor:pointer; }
      .kwik-sched-picks button:hover { border-color:#f97316; color:#fdba74; }
      .kwik-sched-actions { display:flex; gap:8px; justify-content:flex-end; }
      .kwik-sched-cancel { background:transparent; color:#a39bbd; border:1px solid #2a2634; border-radius:10px; padding:8px 14px; cursor:pointer; }
      .kwik-sched-confirm { background:linear-gradient(120deg,#f97316,#a855f7); color:#fff; border:0; border-radius:10px; padding:8px 16px; font-weight:700; cursor:pointer; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(popupEl);

    // events
    popupEl.querySelector('.kwik-sched-backdrop').onclick = closePopup;
    popupEl.querySelector('.kwik-sched-cancel').onclick = closePopup;

    popupEl.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-pick');
        let d;
        if (key === 'today-1930') d = atLocal(19, 30, 0);
        else if (key === 'tomorrow-0900') d = atLocal(9, 0, 1);
        else if (key === 'tomorrow-2015') d = atLocal(20, 15, 1);
        if (d) {
          // if "today" time already passed, push to tomorrow
          if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
          document.getElementById('kwik-sched-input').value = toDatetimeLocalValue(d);
        }
      };
    });

    popupEl.querySelector('.kwik-sched-confirm').onclick = async () => {
      const input = document.getElementById('kwik-sched-input');
      if (!input.value) {
        alert('Pick a date and time');
        return;
      }
      const when = new Date(input.value);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
        alert('Please choose a future date and time');
        return;
      }
      try {
        const btn = popupEl.querySelector('.kwik-sched-confirm');
        btn.disabled = true;
        btn.textContent = 'Scheduling…';
        await api('/api/posts/' + currentPostId + '/schedule', {
          method: 'POST',
          body: JSON.stringify({ scheduledAt: when.toISOString() })
        });
        toast('Scheduled for ' + when.toLocaleString());
        closePopup();
        afterChange();
      } catch (e) {
        alert(e.message);
      } finally {
        const btn = popupEl.querySelector('.kwik-sched-confirm');
        btn.disabled = false;
        btn.textContent = 'Schedule';
      }
    };

    return popupEl;
  }

  function openSchedulePopup(postId) {
    currentPostId = postId;
    const el = ensurePopup();
    const input = document.getElementById('kwik-sched-input');
    // default: tomorrow 9:00 AM
    let def = atLocal(9, 0, 1);
    if (def.getTime() < Date.now()) def = atLocal(9, 0, 2);
    input.value = toDatetimeLocalValue(def);
    el.classList.add('open');
  }

  function closePopup() {
    if (popupEl) popupEl.classList.remove('open');
    currentPostId = null;
  }

  // simple toast (reuses #toast if the demo / app already has one)
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d1b27;color:#fff;border:1px solid #f97316;padding:10px 18px;border-radius:12px;z-index:10000;font-size:14px;opacity:0;transition:.25s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hide);
    t._hide = setTimeout(() => {
      t.style.opacity = '0';
    }, 2800);
  }

  // ── helper to update card badges after loadPosts ─────────────────────────
  // Call this from your render function if you want automatic labels:
  //   updateScheduleBadges(postsArray);
  window.updateScheduleBadges = function (posts) {
    if (!Array.isArray(posts)) return;
    posts.forEach((p) => {
      const card = document.querySelector(`[data-post-id="${p.id}"]`);
      if (!card) return;

      const label = card.querySelector('.sched-label');
      const unBtn = card.querySelector('.unschedule-btn');
      const retryBtn = card.querySelector('.retry-btn');
      const schedBtn = card.querySelector('.schedule-btn');

      if (p.status === 'scheduled' && p.scheduled_at) {
        if (label) label.textContent = 'Scheduled · ' + formatScheduled(p.scheduled_at);
        if (unBtn) unBtn.style.display = '';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) schedBtn.style.display = 'none';
      } else if (p.status === 'failed') {
        if (label) label.textContent = p.last_schedule_error ? 'Failed: ' + p.last_schedule_error : 'Failed';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = '';
        if (schedBtn) schedBtn.style.display = '';
      } else {
        if (label) label.textContent = '';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) schedBtn.style.display = '';
      }
    });
  };
})();