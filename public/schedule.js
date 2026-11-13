/**
 * schedule.js
 * Schedule popup + helper functions for the KwikPost dashboard
 * (index.html) and the Schedule page (schedule.html).
 *
 * Include BEFORE app.js:
 *   <script src="schedule.js"></script>
 *   <script src="app.js"></script>
 *
 * EASIEST way to add the buttons: in the function in app.js that builds each
 * post card, add this inside the card's HTML (and give the card element the
 * attribute data-post-id="${p.id}"):
 *
 *   ${scheduleButtonsHtml(p)}
 *
 * It prints the right buttons for the post's status:
 *   generated      -> no scheduling action until approved
 *   ready_to_post  -> Schedule
 *   scheduled  -> "Scheduled · 5 Nov, 9:00 am", Cancel schedule, Reschedule
 *   failed     -> the error, Retry, Schedule
 *   publishing -> "Publishing…"
 *   posted     -> nothing
 *
 * Or write the buttons yourself:
 *   <button class="schedule-btn" onclick="schedulePost(POST_ID)">Schedule</button>
 *   <button class="unschedule-btn" onclick="unschedulePost(POST_ID)" style="display:none">Cancel schedule</button>
 *   <button class="retry-btn" onclick="retryScheduledPost(POST_ID)" style="display:none">Retry</button>
 *   <span class="sched-label"></span>
 * and call updateScheduleBadges(posts) after the cards are drawn.
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
  window.kwikAuthHeaders = authHeaders; // also used by schedule.html

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers: { ...authHeaders(), ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
    return data;
  }

  // What to refresh after a change: the Schedule page, the dashboard, or a reload.
  async function afterChange() {
    if (typeof window.onScheduleChanged === 'function') {
      await window.onScheduleChanged();
    } else if (typeof window.loadPosts === 'function') {
      await window.loadPosts();
    } else if (typeof window.refreshPosts === 'function') {
      await window.refreshPosts();
    } else {
      // last resort
      await new Promise((resolve) => setTimeout(() => {
        location.reload();
        resolve();
      }, 600));
    }
    if (typeof window.refreshScheduleCalendar === 'function') {
      await window.refreshScheduleCalendar();
    }
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    popupEl.setAttribute('role', 'dialog');
    popupEl.setAttribute('aria-label', 'Schedule post');
    popupEl.innerHTML = `
      <div class="kwik-sched-backdrop"></div>
      <div class="kwik-sched-card">
        <h3>Schedule post</h3>
        <p class="kwik-sched-sub">Pick a date &amp; time. The post will auto-publish to Instagram then.</p>
        <p class="kwik-sched-feedback" role="status" aria-live="polite"></p>

        <label for="kwik-sched-input">Date &amp; time</label>
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
      .kwik-sched-feedback { min-height:18px; margin:0 0 8px; color:#a39bbd; font-size:13px; }
      .kwik-sched-feedback.error { color:#fca5a5; }
      .kwik-sched-card label { display:block; font-size:12px; color:#a39bbd; margin-bottom:4px; }
      #kwik-sched-input { width:100%; box-sizing:border-box; background:#0f0e15; color:#f5f2fb; border:1px solid #2a2634; border-radius:10px; padding:10px 12px; font-size:14px; margin-bottom:12px; color-scheme:dark; }
      .kwik-sched-picks { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
      .kwik-sched-picks button { background:#17151f; color:#a39bbd; border:1px solid #2a2634; border-radius:99px; padding:6px 12px; font-size:12px; cursor:pointer; }
      .kwik-sched-picks button:hover { border-color:#f97316; color:#fdba74; }
      .kwik-sched-actions { display:flex; gap:8px; justify-content:flex-end; }
      .kwik-sched-cancel { background:transparent; color:#a39bbd; border:1px solid #2a2634; border-radius:10px; padding:8px 14px; cursor:pointer; }
      .kwik-sched-confirm { background:linear-gradient(120deg,#f97316,#a855f7); color:#fff; border:0; border-radius:10px; padding:8px 16px; font-weight:700; cursor:pointer; }
      .kwik-sched-confirm:disabled { opacity:.6; cursor:default; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(popupEl);

    // events
    popupEl.querySelector('.kwik-sched-backdrop').onclick = closePopup;
    popupEl.querySelector('.kwik-sched-cancel').onclick = closePopup;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popupEl.classList.contains('open')) closePopup();
    });

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
      const btn = popupEl.querySelector('.kwik-sched-confirm');
      const feedback = popupEl.querySelector('.kwik-sched-feedback');
      if (!input.value) {
        feedback.textContent = 'Pick a date and time.';
        feedback.classList.add('error');
        return;
      }
      // new Date("YYYY-MM-DDTHH:mm") is read in the person's own time zone
      const when = new Date(input.value);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
        feedback.textContent = 'Please choose a future date and time.';
        feedback.classList.add('error');
        return;
      }
      const postId = currentPostId; // closePopup() clears it
      try {
        btn.disabled = true;
        btn.textContent = 'Scheduling…';
        feedback.classList.remove('error');
        feedback.textContent = 'Scheduling…';
        await api('/api/posts/' + postId + '/schedule', {
          method: 'POST',
          body: JSON.stringify({ scheduledAt: when.toISOString() })
        });
        toast('Scheduled for ' + when.toLocaleString());
        feedback.textContent = 'Scheduled. Refreshing status counts…';
        closePopup();
        await afterChange();
      } catch (e) {
        feedback.textContent = 'Could not schedule: ' + e.message;
        feedback.classList.add('error');
      } finally {
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
    const feedback = el.querySelector('.kwik-sched-feedback');
    feedback.textContent = '';
    feedback.classList.remove('error');
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

  // The reason a post failed. The database column is error_message;
  // last_schedule_error is accepted for older data.
  function errorOf(p) {
    return p.last_error || p.error_message || p.last_schedule_error || '';
  }

  // ── buttons for a post card ──────────────────────────────────────────────
  // Returns HTML for the schedule buttons of one post (see the top of this file).
  window.scheduleButtonsHtml = function (p) {
    const id = Number(p && p.id);
    if (!Number.isFinite(id)) return '';
    const status = p.status || 'generated';
    const cls = 'btn-secondary';

    if (status === 'posted') return '';
    if (status === 'publishing') return '<span class="sched-label">Publishing…</span>';

    if (status === 'scheduled') {
      return (
        `<span class="sched-label">Scheduled · ${esc(window.formatScheduled(p.scheduled_at))}</span>` +
        `<button type="button" class="unschedule-btn ${cls}" onclick="unschedulePost(${id})">Cancel schedule</button>`
      );
    }

    if (status === 'failed') {
      const err = errorOf(p);
      return (
        `<span class="sched-label">${err ? 'Failed: ' + esc(err) : 'Failed'}</span>` +
        `<button type="button" class="retry-btn ${cls}" onclick="retryScheduledPost(${id})">Retry</button>` +
        `<button type="button" class="schedule-btn ${cls}" onclick="schedulePost(${id})">Schedule</button>`
      );
    }

    if (status === 'ready_to_post') return `<button type="button" class="schedule-btn ${cls}" onclick="schedulePost(${id})">Schedule</button>`;
    return '';
  };

  // ── helper to update card badges after loadPosts ─────────────────────────
  // For hand-written buttons: call this from your render function
  //   updateScheduleBadges(postsArray);
  // Each card needs data-post-id="<id>" and the classes shown at the top.
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
        if (retryBtn) retryBtn.style.display = p.last_error ? '' : 'none';
        if (schedBtn) schedBtn.style.display = 'none';
      } else if (p.status === 'publishing') {
        if (label) label.textContent = 'Publishing…';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) schedBtn.style.display = 'none';
      } else if (p.status === 'failed') {
        const err = errorOf(p);
        if (label) label.textContent = err ? 'Failed: ' + err : 'Failed';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = '';
        if (schedBtn) { schedBtn.style.display = ''; schedBtn.textContent = 'Schedule'; }
      } else if (p.status === 'posted') {
        if (label) label.textContent = '';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) schedBtn.style.display = 'none';
      } else if (p.status === 'ready_to_post') {
        if (label) label.textContent = '';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) { schedBtn.style.display = ''; schedBtn.textContent = 'Schedule'; }
      } else {
        if (label) label.textContent = '';
        if (unBtn) unBtn.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'none';
        if (schedBtn) schedBtn.style.display = 'none';
      }
    });
  };
})();