(function () {
  var root = document.querySelector('[data-schedule-calendar]');
  if (!root) return;

  var contentType = root.dataset.contentType;
  var monthDate = new Date();
  monthDate.setDate(1);
  var selectedDate = new Date();
  var posts = [];
  var campaigns = {};
  var campaignsPromise = null;
  var requestVersion = 0;
  var $ = function (selector) { return root.querySelector(selector); };
  var grid = $('[data-calendar-grid]');
  var monthLabel = $('[data-calendar-month]');
  var statusBox = $('[data-calendar-status]');
  var details = $('[data-calendar-details]');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dateKey(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function parseTimestamp(value) {
    if (!value) return null;
    var normalized = String(value).trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(normalized)) normalized += 'Z';
    var date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateFor(post) {
    var value = post.status === 'posted'
      ? (post.posted_at || post.created_at)
      : post.scheduled_at;
    return parseTimestamp(value);
  }

  function formatDate(date) {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function formatTime(value) {
    return typeof window.formatScheduled === 'function'
      ? window.formatScheduled(value)
      : new Date(value).toLocaleString();
  }

  function formatDayTime(value) {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function toLocalInputValue(date) {
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function titleFor(post) {
    return post.headline_main || String(post.caption || post.content || '').split('\n')[0] ||
      (post.content_type === 'reel' ? 'Video post #' : 'Image post #') + post.id;
  }

  function campaignFor(post) {
    return campaigns[String(post.campaign_id)] || 'Campaign';
  }

  function thumbnailUrl(post) {
    return post.content_type === 'reel'
      ? (post.video_thumb_url || post.image_url || '')
      : (post.image_url || '');
  }

  function thumbnail(post) {
    var url = thumbnailUrl(post);
    if (!url) {
      return '<span class="schedule-calendar-thumb" aria-hidden="true">' +
        (post.content_type === 'reel' ? 'Video' : 'Image') + '</span>';
    }
    return '<span class="schedule-calendar-thumb"><img loading="lazy" src="' +
      escapeHtml(url) + '" alt="" /></span>';
  }

  function isPosted(post) {
    return post.status === 'posted';
  }

  function itemsForDay(date) {
    var key = dateKey(date);
    return posts.filter(function (post) {
      var postDate = dateFor(post);
      return postDate && dateKey(postDate) === key;
    }).sort(function (a, b) { return dateFor(a) - dateFor(b); });
  }

  function setStatus(message, isError, retry) {
    statusBox.textContent = message;
    statusBox.classList.toggle('error', !!isError);
    if (retry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.addEventListener('click', refresh);
      statusBox.appendChild(button);
    }
  }

  function renderDayItem(post) {
    var posted = isPosted(post);
    return '<span class="schedule-calendar-item' + (posted ? ' is-posted' : '') + '"' +
      (posted ? '' : ' data-calendar-post="' + escapeHtml(post.id) + '" draggable="true" tabindex="0"') + '>' +
      thumbnail(post) +
      '<span class="schedule-calendar-item-copy">' +
        '<span class="schedule-calendar-item-time">' + (posted ? 'Posted · ' : 'Scheduled · ') +
          escapeHtml(formatDayTime(dateFor(post).toISOString())) + '</span>' +
        '<span class="schedule-calendar-item-title">' + escapeHtml(titleFor(post)) + '</span>' +
        '<span class="schedule-calendar-item-campaign">' + escapeHtml(campaignFor(post)) +
          ' · ' + (post.content_type === 'reel' ? 'Reel' : 'Image') + '</span>' +
      '</span>' +
    '</span>';
  }

  function renderCalendar() {
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    monthLabel.textContent = monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    var firstWeekday = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = dateKey(new Date());
    var cells = [];

    for (var blank = 0; blank < firstWeekday; blank += 1) {
      cells.push('<div class="schedule-calendar-blank" aria-hidden="true"></div>');
    }
    for (var dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      var day = new Date(year, month, dayNumber);
      var key = dateKey(day);
      var dayPosts = itemsForDay(day);
      var labels = dayPosts.map(function (post) {
        return (isPosted(post) ? 'Posted' : 'Scheduled') + ' ' + titleFor(post);
      }).join(', ');
      var selected = key === dateKey(selectedDate);
      var today = key === todayKey;
      cells.push(
        '<button type="button" class="schedule-calendar-day' +
          (selected ? ' is-selected' : '') + (today ? ' is-today' : '') +
          '" data-calendar-day="' + key + '" aria-label="' + escapeHtml(formatDate(day) +
            (labels ? ': ' + labels : ': no scheduled or posted items')) + '">' +
          '<span class="schedule-calendar-day-number">' + dayNumber + '</span>' +
          '<span class="schedule-calendar-day-items">' +
            (dayPosts.length ? dayPosts.map(renderDayItem).join('') :
              '<span class="schedule-calendar-day-empty">—</span>') +
          '</span>' +
        '</button>'
      );
    }
    grid.innerHTML = cells.join('');

    var weekdayNames = Array.from({ length: 7 }, function (_, index) {
      return new Date(2024, 0, 7 + index).toLocaleDateString(undefined, { weekday: 'short' });
    });
    $('[data-calendar-weekdays]').innerHTML = weekdayNames.map(function (dayName) {
      return '<span class="schedule-calendar-weekday">' + escapeHtml(dayName) + '</span>';
    }).join('');

    if (!posts.length) {
      setStatus('No scheduled or posted items this month.');
    } else {
      setStatus('');
    }
    renderDetails();
  }

  function renderDetails() {
    var dayPosts = itemsForDay(selectedDate);
    details.hidden = false;
    $('[data-calendar-details-title]').textContent = formatDate(selectedDate);
    var list = $('[data-calendar-detail-list]');
    if (!dayPosts.length) {
      list.innerHTML = '<p class="schedule-calendar-empty">Nothing scheduled or posted on this day.</p>';
      return;
    }

    list.innerHTML = dayPosts.map(function (post) {
      var posted = isPosted(post);
      var date = dateFor(post);
      var title = titleFor(post);
      var previewUrl = thumbnailUrl(post);
      var media = post.content_type === 'reel' && post.video_url
        ? '<video class="schedule-calendar-detail-media" controls playsinline preload="metadata"' +
          (previewUrl ? ' poster="' + escapeHtml(previewUrl) + '"' : '') +
          ' src="' + escapeHtml(post.video_url) + '"></video>'
        : (previewUrl
          ? '<img class="schedule-calendar-detail-media" loading="lazy" src="' +
            escapeHtml(previewUrl) + '" alt="' + escapeHtml(title) + '" />'
          : '<div class="schedule-calendar-detail-media"></div>');
      var rescheduleAction = !posted
        ? '<button type="button" class="schedule-calendar-reschedule-toggle" data-open-reschedule="' +
          escapeHtml(post.id) + '">Reschedule</button>' +
          '<form class="schedule-calendar-reschedule-form" data-reschedule-form="' + escapeHtml(post.id) + '" hidden>' +
            '<label>Date and time <input type="datetime-local" name="scheduledAt" required min="' +
              escapeHtml(toLocalInputValue(new Date(Date.now() + 60000))) + '" value="' +
              escapeHtml(toLocalInputValue(date)) + '" /></label>' +
            '<div class="schedule-calendar-reschedule-actions">' +
              '<button type="submit">Save new time</button>' +
              '<button type="button" class="schedule-calendar-reschedule-cancel" data-cancel-reschedule>Cancel</button>' +
            '</div>' +
            '<p class="schedule-calendar-reschedule-error" role="alert"></p>' +
          '</form>'
        : '';
      return '<article class="schedule-calendar-detail' + (posted ? ' is-posted' : '') + '">' +
        media +
        '<div class="schedule-calendar-detail-copy">' +
          '<span class="schedule-calendar-status-label ' + (posted ? 'is-posted' : 'is-scheduled') + '">' +
            (posted ? 'Posted' : 'Scheduled') + '</span>' +
          '<p class="schedule-calendar-detail-title">' + escapeHtml(title) + '</p>' +
          '<p class="schedule-calendar-detail-meta">' + escapeHtml(formatTime(date.toISOString())) + '</p>' +
          '<p class="schedule-calendar-detail-meta">' + (post.content_type === 'reel' ? 'Reel / Video' : 'Image post') + '</p>' +
          '<p class="schedule-calendar-detail-meta">' + escapeHtml(campaignFor(post)) + '</p>' +
          rescheduleAction +
        '</div>' +
      '</article>';
    }).join('');
  }

  async function request(url, options) {
    options = options || {};
    var token = localStorage.getItem('authToken') || localStorage.getItem('token') || '';
    var headers = Object.assign(
      { Authorization: 'Bearer ' + token, 'ngrok-skip-browser-warning': 'true' },
      options.headers || {}
    );
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    var response = await fetch(url, Object.assign({}, options, { headers: headers }));
    var data = null;
    try { data = await response.json(); } catch (error) {}
    if (response.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Session expired. Sign in again.');
    }
    if (!response.ok || (data && data.error)) {
      throw new Error((data && data.error) || 'Request failed (' + response.status + ')');
    }
    return data;
  }

  async function refreshScheduledSection() {
    if (typeof window.onScheduleChanged === 'function') {
      await window.onScheduleChanged();
    } else if (typeof window.loadPosts === 'function') {
      await window.loadPosts();
    }
  }

  async function saveReschedule(post, scheduledAt, errorElement, submitButton) {
    submitButton.disabled = true;
    errorElement.textContent = 'Saving new schedule…';
    errorElement.classList.remove('error');
    try {
      var updated = await request('/api/posts/' + encodeURIComponent(post.id) + '/schedule', {
        method: 'PATCH',
        body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() })
      });
      selectedDate = new Date(scheduledAt.getFullYear(), scheduledAt.getMonth(), scheduledAt.getDate());
      monthDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      setStatus(updated.message || 'Schedule updated.');
      await refreshScheduledSection();
      await refresh();
    } catch (error) {
      errorElement.textContent = 'Could not reschedule: ' + error.message;
      errorElement.classList.add('error');
      submitButton.disabled = false;
    }
  }

  function moveToDay(postId, dayKey) {
    var post = posts.find(function (item) {
      return String(item.id) === String(postId) && item.status === 'scheduled';
    });
    if (!post) return;
    var originalDate = dateFor(post);
    if (!originalDate) return;
    var parts = dayKey.split('-').map(Number);
    var targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
    targetDate.setHours(
      originalDate.getHours(),
      originalDate.getMinutes(),
      originalDate.getSeconds(),
      originalDate.getMilliseconds()
    );
    if (targetDate.getTime() === originalDate.getTime()) return;
    var errorBox = $('[data-calendar-details]');
    var inlineError = document.createElement('p');
    inlineError.className = 'schedule-calendar-reschedule-error error';
    inlineError.setAttribute('role', 'alert');
    inlineError.textContent = 'Moving schedule…';
    errorBox.insertBefore(inlineError, $('[data-calendar-detail-list]'));
    var submitButton = document.createElement('button');
    submitButton.disabled = true;
    saveReschedule(post, targetDate, inlineError, submitButton);
  }

  async function loadCampaigns() {
    if (!campaignsPromise) {
      campaignsPromise = request('/api/campaigns').then(function (data) {
        var list = Array.isArray(data) ? data : ((data && data.campaigns) || []);
        campaigns = {};
        list.forEach(function (campaign) {
          campaigns[String(campaign.id)] = campaign.product_name || campaign.productName || campaign.name ||
            'Campaign ' + campaign.id;
        });
      }).catch(function (error) {
        campaignsPromise = null;
        throw error;
      });
    }
    return campaignsPromise;
  }

  async function refresh() {
    var version = ++requestVersion;
    var year = monthDate.getFullYear();
    var month = monthDate.getMonth();
    var from = new Date(year, month, 1).toISOString();
    var to = new Date(year, month + 1, 1).toISOString();
    setStatus('Loading calendar…');
    grid.setAttribute('aria-busy', 'true');
    details.hidden = true;
    grid.innerHTML = '<p class="schedule-calendar-empty">Loading calendar…</p>';
    try {
      var query = new URLSearchParams({
        content_type: contentType,
        from: from,
        to: to
      });
      var results = await Promise.all([
        request('/api/posts/schedule-calendar?' + query.toString()),
        loadCampaigns()
      ]);
      if (version !== requestVersion) return;
      posts = Array.isArray(results[0]) ? results[0] : ((results[0] && results[0].posts) || []);
      renderCalendar();
    } catch (error) {
      if (version !== requestVersion) return;
      setStatus('Could not load the schedule: ' + error.message, true, true);
      grid.innerHTML = '<p class="schedule-calendar-empty">Schedule data is unavailable.</p>';
      details.hidden = true;
    } finally {
      if (version === requestVersion) grid.removeAttribute('aria-busy');
    }
  }

  root.addEventListener('click', function (event) {
    var openReschedule = event.target.closest('[data-open-reschedule]');
    if (openReschedule) {
      var form = root.querySelector('[data-reschedule-form="' + CSS.escape(openReschedule.dataset.openReschedule) + '"]');
      if (form) {
        form.hidden = false;
        openReschedule.hidden = true;
        form.querySelector('input[name="scheduledAt"]').focus();
      }
      return;
    }
    if (event.target.closest('[data-cancel-reschedule]')) {
      var activeForm = event.target.closest('[data-reschedule-form]');
      if (activeForm) {
        activeForm.hidden = true;
        var toggle = root.querySelector('[data-open-reschedule="' + CSS.escape(activeForm.dataset.rescheduleForm) + '"]');
        if (toggle) toggle.hidden = false;
      }
      return;
    }
    var target = event.target.closest('[data-calendar-day]');
    if (!target) return;
    var parts = target.dataset.calendarDay.split('-').map(Number);
    selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
    renderCalendar();
    $('[data-calendar-details]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  root.addEventListener('submit', function (event) {
    var form = event.target.closest('[data-reschedule-form]');
    if (!form) return;
    event.preventDefault();
    var post = posts.find(function (item) {
      return String(item.id) === String(form.dataset.rescheduleForm);
    });
    var input = form.querySelector('input[name="scheduledAt"]');
    var errorElement = form.querySelector('.schedule-calendar-reschedule-error');
    var submitButton = form.querySelector('button[type="submit"]');
    if (!post || post.status !== 'scheduled') {
      errorElement.textContent = 'This item is no longer scheduled.';
      errorElement.classList.add('error');
      return;
    }
    var scheduledAt = new Date(input.value);
    if (!input.value || Number.isNaN(scheduledAt.getTime())) {
      errorElement.textContent = 'Choose a valid date and time.';
      errorElement.classList.add('error');
      return;
    }
    saveReschedule(post, scheduledAt, errorElement, submitButton);
  });
  root.addEventListener('dragstart', function (event) {
    var item = event.target.closest('[data-calendar-post]');
    if (!item || !event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', item.dataset.calendarPost);
    event.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', function (event) {
    if (event.target.closest('[data-calendar-day]')) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  });
  root.addEventListener('drop', function (event) {
    var day = event.target.closest('[data-calendar-day]');
    if (!day || !event.dataTransfer) return;
    event.preventDefault();
    moveToDay(event.dataTransfer.getData('text/plain'), day.dataset.calendarDay);
  });
  $('[data-calendar-prev]').addEventListener('click', function () {
    monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
    selectedDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    refresh();
  });
  $('[data-calendar-next]').addEventListener('click', function () {
    monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
    selectedDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    refresh();
  });

  window.refreshScheduleCalendar = refresh;
  window.addEventListener('focus', refresh);
  window.setInterval(function () {
    if (!document.hidden) refresh();
  }, 60000);
  refresh();
})();
