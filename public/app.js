/* KwikPost - frontend logic
   Campaigns, posts, onboarding, theme, Edit text (opens edit.html),
   Claim now contact popup
   + Schedule / auto-publish buttons */

const CAMPAIGNS_API = '/api/campaigns';
const POSTS_API     = '/api/posts';
const ME_API        = '/api/auth/me';
const CONTENT_TYPE  = 'image';
const SELECTED_CAMPAIGN_KEY = 'kwik-selected-campaign';

// ===== AUTH =====
function getToken() {
  return localStorage.getItem('authToken') || localStorage.getItem('token') || '';
}
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('token');
  window.location.href = '/login.html';
}
if (!getToken()) {
  window.location.href = '/login.html';
}

function authHeaders(extra) {
  const headers = Object.assign({ 'ngrok-skip-browser-warning': 'true' }, extra || {});
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  return headers;
}

// ===== HELPERS =====
async function api(url, options) {
  options = options || {};
  const headers = authHeaders(options.headers);
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, Object.assign({}, options, { headers: headers }));
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || (data && data.error)) {
    throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  }
  return data;
}

function esc(v) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return map[c]; });
}

function safeHashtags(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function $(id) { return document.getElementById(id); }

async function withBusy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
function btnOf(evt) { return evt && (evt.currentTarget || evt.target) || null; }

function fieldValue(id) {
  const el = $(id);
  return el ? el.value.trim() : '';
}

// ===== CAMPAIGN FORM =====
function campaignFormValues() {
  return {
    productName: fieldValue('productName'),
    audience: fieldValue('audience'),
    tone: fieldValue('tone'),
    offerDetails: fieldValue('offerDetails'),
    website: fieldValue('website'),
    logoUrl: fieldValue('logoUrl')
  };
}

function clearCampaignForm() {
  ['productName', 'audience', 'tone', 'offerDetails', 'website', 'logoUrl']
    .forEach(function (id) { if ($(id)) $(id).value = ''; });
  if ($('logoFile')) $('logoFile').value = '';
  if ($('logoPreview')) {
    $('logoPreview').removeAttribute('src');
    $('logoPreview').style.display = 'none';
  }
  if ($('logoUploadStatus')) {
    $('logoUploadStatus').className = 'settings-note';
    $('logoUploadStatus').textContent = 'Required for generated Reels/videos; optional for image posts.';
  }
}

function campaignPayload(v) {
  return {
    productName: v.productName,
    audience: v.audience,
    tone: v.tone,
    offerDetails: v.offerDetails,
    website: v.website,
    logoUrl: v.logoUrl,
    product_name: v.productName,
    offer_details: v.offerDetails,
    logo_url: v.logoUrl
  };
}

function showCampaignLogo(url) {
  const preview = $('logoPreview');
  if (!preview) return;
  if (url) {
    preview.src = url;
    preview.style.display = '';
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
}

async function uploadCampaignLogo(evt) {
  const input = evt && evt.target;
  const file = input && input.files && input.files[0];
  if (!file) return;

  const status = $('logoUploadStatus');
  status.className = 'settings-note';
  status.textContent = 'Uploading logo…';
  const formData = new FormData();
  formData.append('logo', file);

  try {
    const response = await fetch(CAMPAIGNS_API + '/logo', {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });
    if (response.status === 401) {
      logout();
      throw new Error('Session expired');
    }
    let data = null;
    try { data = await response.json(); } catch (error) {}
    if (!response.ok || (data && data.error)) {
      throw new Error((data && data.error) || 'Logo upload failed (' + response.status + ')');
    }

    $('logoUrl').value = data.logoUrl;
    showCampaignLogo(data.logoUrl);
    status.textContent = 'Logo uploaded. Save the campaign to use it in generated videos.';
    input.value = '';
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'Logo upload failed: ' + error.message;
    input.value = '';
  }
}

// ===== REDIRECT MESSAGES =====
(function handleRedirectMessages() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('instagram_connected') === '1') {
    const b = $('igSuccessBanner');
    if (b) b.style.display = 'block';
    window.history.replaceState({}, document.title, '/index.html');
  }
  if (params.get('instagram_error')) {
    const box = $('igErrorBanner');
    if (box) {
      box.style.display = 'block';
      box.textContent = '❌ ' + params.get('instagram_error');
    }
    window.history.replaceState({}, document.title, '/index.html');
  }
})();

// ===== INSTAGRAM =====
function connectInstagram() {
  window.location.href = '/api/instagram/auth/start?token=' + encodeURIComponent(getToken());
}

async function disconnectInstagram() {
  if (!confirm('Are you sure you want to disconnect Instagram?')) return;
  try {
    await api('/api/instagram/disconnect', { method: 'POST' });
    alert('Instagram disconnected');
    checkInstagramStatus();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function checkInstagramStatus() {
  try {
    const user = await api(ME_API);
    if (user && user.email && $('userEmail')) $('userEmail').textContent = user.email;
    const connected = !!(user && user.instagram_business_account_id);
    onboard.connected = connected;
    updateOnboarding();
    if ($('igStatusText')) {
      $('igStatusText').innerHTML = connected
        ? '✅ Connected to <strong>' + esc(user.instagram_page_name || 'Instagram account') + '</strong>'
        : '❌ No Instagram account connected';
    }
    if ($('igStatusBox')) $('igStatusBox').classList.toggle('ig-connected', connected);
    if ($('connectBtn')) $('connectBtn').style.display = connected ? 'none' : 'inline-block';
    if ($('disconnectBtn')) $('disconnectBtn').style.display = connected ? 'inline-block' : 'none';
  } catch (err) {
    console.error('Failed to check Instagram status:', err);
    if ($('igStatusText')) $('igStatusText').textContent = 'Could not check status';
  }
}

// ===== CAMPAIGNS =====
let campaignsCache = [];
let editingCampaignId = null;
let postsCache = [];

async function loadCampaigns() {
  const sel = $('campaignSelect');
  const listBox = $('campaignsList');
  if (!sel) return;
  try {
    const data = await api(CAMPAIGNS_API);
    const list = Array.isArray(data) ? data : ((data && data.campaigns) || []);
    campaignsCache = list;
    onboard.campaigns = list.length;
    updateOnboarding();

    const current = sel.value || localStorage.getItem(SELECTED_CAMPAIGN_KEY);
    sel.innerHTML = list.length
      ? list.map(function (c) {
          return '<option value="' + esc(c.id) + '">' +
                 esc(c.product_name || c.productName || c.name || ('Campaign ' + c.id)) + '</option>';
        }).join('')
      : '<option value="">No campaigns yet</option>';
    if (current && list.some(function (c) { return String(c.id) === String(current); })) {
      sel.value = current;
    }
    if (sel.value) localStorage.setItem(SELECTED_CAMPAIGN_KEY, sel.value);

    if (listBox) {
      if (!list.length) {
        listBox.innerHTML = '<p class="settings-note">No campaigns yet. Create one above.</p>';
      } else {
        listBox.innerHTML = list.map(function (c) {
          const name = esc(c.product_name || c.productName || c.name || ('Campaign ' + c.id));
          const audience = esc(c.audience || '');
          const tone = esc(c.tone || '');
          const email = esc(c.contact_email || '');
          const wa = esc(c.whatsapp_number || '');
          return '' +
            '<div class="post-card" style="margin-bottom:12px;">' +
              '<b>' + name + '</b>' +
              (audience ? '<p class="settings-note" style="margin:4px 0 0;">Audience: ' + audience + '</p>' : '') +
              (tone ? '<p class="settings-note" style="margin:2px 0 0;">Tone: ' + tone + '</p>' : '') +
              (email ? '<p class="settings-note" style="margin:2px 0 0;">Claim email: ' + email + '</p>' : '') +
              (wa ? '<p class="settings-note" style="margin:2px 0 0;">Claim WhatsApp: ' + wa + '</p>' : '') +
              '<div class="actions">' +
                '<button type="button" onclick="startEditCampaign(' + esc(JSON.stringify(c.id)) + ')">Edit</button>' +
                '<button type="button" class="btn-danger" onclick="deleteCampaign(' + esc(JSON.stringify(c.id)) + ', event)">Delete</button>' +
              '</div>' +
            '</div>';
        }).join('');
      }
    }
  } catch (err) {
    sel.innerHTML = '<option value="">Could not load campaigns</option>';
    if (listBox) listBox.innerHTML = '<p class="settings-note">Could not load campaigns.</p>';
  }
}

function createCampaign(evt) {
  return withBusy(btnOf(evt), async function () {
    const v = campaignFormValues();
    if (!v.productName) throw new Error('Product/Service name is required');

    await api(CAMPAIGNS_API, {
      method: 'POST',
      body: JSON.stringify(campaignPayload(v))
    });

    clearCampaignForm();
    cancelEdit();
    alert('Campaign saved');
    await loadCampaigns();
  });
}

function startEditCampaign(id) {
  const c = campaignsCache.find(function (x) { return String(x.id) === String(id); });
  if (!c) return alert('Campaign not found');

  editingCampaignId = id;

  if ($('productName')) $('productName').value = c.product_name || c.productName || '';
  if ($('audience')) $('audience').value = c.audience || '';
  if ($('tone')) $('tone').value = c.tone || '';
  if ($('offerDetails')) $('offerDetails').value = c.offer_details || c.offerDetails || '';
  if ($('website')) $('website').value = c.website || '';
  if ($('logoUrl')) $('logoUrl').value = c.logo_url || c.logoUrl || '';
  showCampaignLogo(c.logo_url || c.logoUrl || '');
  if ($('logoUploadStatus')) {
    $('logoUploadStatus').textContent = c.logo_url || c.logoUrl
      ? 'Saved logo. Upload another image to replace it.'
      : 'Required for generated Reels/videos; optional for image posts.';
  }

  if ($('updateCampaignBtn')) $('updateCampaignBtn').style.display = 'inline-block';
  if ($('cancelEditBtn')) $('cancelEditBtn').style.display = 'inline-block';

  goToSection('sec-campaign');
}

function cancelEdit() {
  editingCampaignId = null;
  clearCampaignForm();
  if ($('updateCampaignBtn')) $('updateCampaignBtn').style.display = 'none';
  if ($('cancelEditBtn')) $('cancelEditBtn').style.display = 'none';
}

function updateCampaign(evt) {
  if (!editingCampaignId) return;
  return withBusy(btnOf(evt), async function () {
    const v = campaignFormValues();
    if (!v.productName) throw new Error('Product/Service name is required');

    await api(CAMPAIGNS_API + '/' + encodeURIComponent(editingCampaignId), {
      method: 'PUT',
      body: JSON.stringify(campaignPayload(v))
    });

    cancelEdit();
    alert('Campaign updated');
    await loadCampaigns();
  });
}

function deleteCampaign(id, evt) {
  if (!confirm('Delete this campaign? This cannot be undone.')) return;
  return withBusy(btnOf(evt), async function () {
    await api(CAMPAIGNS_API + '/' + encodeURIComponent(id), { method: 'DELETE' });
    alert('Campaign deleted');
    await loadCampaigns();
  });
}

// ===== CLAIM CONTACT POPUP =====
function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function closeClaim() {
  const o = $('claimOverlay');
  if (o) o.classList.remove('open');
}

function renderClaim(campaign) {
  const content = $('claimContent');
  if (!content) return;
  content.textContent = '';

  const email = String((campaign && campaign.contact_email) || '').trim();
  const phone = digitsOnly(campaign && campaign.whatsapp_number);
  const product = (campaign && (campaign.product_name || campaign.productName)) || 'your offer';

  if (!email && !phone) {
    const p = document.createElement('p');
    p.className = 'claim-empty';
    p.textContent = 'No contact details have been added for this campaign yet.';
    content.appendChild(p);
    return;
  }

  if (email) {
    const row = document.createElement('div');
    row.className = 'claim-row';
    const a = document.createElement('a');
    a.href = 'mailto:' + email;
    a.textContent = '📧 ' + email;
    row.appendChild(a);
    content.appendChild(row);
  }

  if (phone) {
    const row = document.createElement('div');
    row.className = 'claim-row';
    const a = document.createElement('a');
    a.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent("Hi, I'm interested in " + product);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '💬 Chat on WhatsApp';
    row.appendChild(a);
    content.appendChild(row);
  }
}

async function openClaim(imageSrc) {
  const overlay = $('claimOverlay');
  const content = $('claimContent');
  if (!overlay || !content) return;

  content.textContent = 'Loading...';
  overlay.classList.add('open');

  try {
    const [posts] = await Promise.all([api(POSTS_API + '?content_type=image'), loadCampaigns()]);
    const list = Array.isArray(posts) ? posts : ((posts && posts.posts) || []);
    const post = list.find(function (p) { return p.image_url && p.image_url === imageSrc; });
    const campaignId = post ? post.campaign_id : ($('campaignSelect') && $('campaignSelect').value);
    const campaign = campaignsCache.find(function (c) { return String(c.id) === String(campaignId); });
    renderClaim(campaign);
  } catch (err) {
    content.textContent = '';
    const p = document.createElement('p');
    p.className = 'claim-empty';
    p.textContent = 'Could not load contact details: ' + err.message;
    content.appendChild(p);
  }
}

function injectClaimButtons() {
  document.querySelectorAll('#postsList .post-card').forEach(function (card) {
    if (card.querySelector('.claim-now-wrap')) return;
    if (card.querySelector('.status.posted')) return;
    const img = card.querySelector('img');
    if (!img) return;

    const wrap = document.createElement('div');
    wrap.className = 'claim-now-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claim-now-btn';
    btn.textContent = 'Claim now';
    btn.addEventListener('click', function () { openClaim(img.getAttribute('src')); });

    wrap.appendChild(btn);
    img.insertAdjacentElement('afterend', wrap);
  });
}

// ===== GENERATE =====
function generatePost(evt) {
  return withBusy(btnOf(evt), async function () {
    const campaign_id = $('campaignSelect').value;
    if (!campaign_id) throw new Error('Create/select a campaign first');

    const photoId = $('genPhoto') ? $('genPhoto').value : '';
    await api(CAMPAIGNS_API + '/' + encodeURIComponent(campaign_id) + '/generate', {
      method: 'POST',
      body: JSON.stringify({ libraryImageId: photoId || null })
    });
    await loadPosts();
  });
}

// ===== PHOTO LIBRARY UPLOAD =====
const LIBRARY_API = '/api/library';

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error('Could not read the file')); };
    reader.readAsDataURL(file);
  });
}

async function loadLibraryList() {
  const box = $('libList');
  if (!box) return;
  try {
    const rows = await api(LIBRARY_API);
    const list = Array.isArray(rows) ? rows : [];
    box.textContent = list.length
      ? 'Saved photos (' + list.length + '): ' + list.map(function (r) { return r.title; }).join(', ')
      : 'No saved photos yet.';
  } catch (err) {
    box.textContent = 'Could not load saved photos.';
  }
}

function uploadLibraryImage(evt) {
  return withBusy(btnOf(evt), async function () {
    const input = $('libFile');
    const status = $('libStatus');
    const file = input && input.files[0];
    if (!file) throw new Error('Choose an image first');
    if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Only JPG or PNG images');
    if (file.size > 8 * 1024 * 1024) throw new Error('Image must be under 8 MB');

    if (status) status.textContent = 'Uploading...';
    const imageData = await readFileAsDataUrl(file);
    const title = fieldValue('libTitle') || file.name;

    await api(LIBRARY_API, {
      method: 'POST',
      body: JSON.stringify({ title: title, imageData: imageData })
    });

    input.value = '';
    if ($('libTitle')) $('libTitle').value = '';
    if (status) status.textContent = 'Saved to the database.';
    await loadLibraryList();
  });
}

loadLibraryList();

// ===== DAILY THEMES =====
function saveThemes(evt) {
  return withBusy(btnOf(evt), async function () {
    const themes = $('themesInput').value.split('\n').map(function (t) { return t.trim(); }).filter(Boolean);
    if (!themes.length) throw new Error('Enter at least one theme');
    if (themes.length > 20) throw new Error('Maximum 20 themes');
    const campaign_id = $('campaignSelect').value;
    if (!campaign_id) throw new Error('Select a campaign first');
    await api(CAMPAIGNS_API + '/' + encodeURIComponent(campaign_id) + '/themes', {
      method: 'POST',
      body: JSON.stringify({ themes: themes })
    });
    if ($('themesStatus')) {
      $('themesStatus').textContent = '✅ Saved ' + themes.length + ' theme(s) to the selected campaign';
    }
  });
}

// ===== POSTS (with Schedule / Cancel / Retry) =====
async function loadPosts() {
  const box = $('postsList');
  try {
    const data = await api(POSTS_API + '?content_type=' + CONTENT_TYPE);
    const posts = Array.isArray(data) ? data : ((data && data.posts) || []);
    postsCache = posts;

    document.dispatchEvent(new CustomEvent('kwik:posts', { detail: posts }));

    onboard.posts = posts.length;
    onboard.approvedCount = posts.filter(function (p) {
      return p.status === 'ready_to_post' || p.status === 'scheduled' || p.status === 'posted';
    }).length;
    onboard.approved = onboard.approvedCount > 0;
    updateOnboarding();

    if (!box) return;
    box.innerHTML = posts.length
      ? posts.map(renderImagePostCard).join('')
      : '<p class="post-list-state">No posts yet. Generate your first one in step 3 above.</p>';

    injectClaimButtons();

    if (typeof updateScheduleBadges === 'function') {
      updateScheduleBadges(posts);
    }
  } catch (err) {
    if (box) box.innerHTML = '<p class="post-list-state error">Could not load posts: ' + esc(err.message) + '</p>';
  }
}

function workflowDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

function renderImagePostCard(post) {
  const campaign = campaignsCache.find(function (item) { return String(item.id) === String(post.campaign_id); });
  const campaignName = campaign ? (campaign.product_name || campaign.productName || campaign.name) : 'Campaign';
  const title = post.headline_main || (post.caption || post.content || ('Image post #' + post.id)).split('\n')[0];
  const dateLabel = post.status === 'posted'
    ? 'Posted ' + workflowDate(post.posted_at || post.created_at)
    : (post.status === 'scheduled'
      ? 'Scheduled ' + workflowDate(post.scheduled_at)
      : 'Created ' + workflowDate(post.created_at));
  const id = esc(JSON.stringify(post.id));
  const statusLabel = esc(post.status.replace(/_/g, ' '));
  const image = post.image_url
    ? '<img src="' + esc(post.image_url) + (post.image_url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now() + '" alt="Image ad preview" />'
    : '<div class="post-list-state">Image preview unavailable</div>';
  let actions = '';
  if (post.status === 'generated') {
    actions = '<button type="button" onclick="openImageEditor(' + id + ', this)">Edit</button>' +
      '<button type="button" onclick="runImageAction(' + id + ', this, \'approve\')">Approve</button>' +
      '<button type="button" class="btn-danger" onclick="runImageAction(' + id + ', this, \'reject\')">Reject</button>';
  } else if (post.status === 'ready_to_post') {
    actions = '<button type="button" onclick="schedulePost(' + id + ')">Schedule</button>' +
      '<button type="button" class="btn-secondary" onclick="runImageAction(' + id + ', this, \'back-to-generated\')">Back to Generated</button>';
  } else if (post.status === 'scheduled') {
    actions = '<button type="button" class="unschedule-btn" onclick="runImageAction(' + id + ', this, \'unschedule\')">Unschedule</button>' +
      (post.last_error
        ? '<button type="button" class="retry-btn" onclick="runImageAction(' + id + ', this, \'retry\')">Retry</button>'
        : '');
  }
  const error = post.last_error
    ? '<p class="action-feedback error">Last publish error: ' + esc(post.last_error) + '</p>'
    : '';
  return '<article class="post-card" data-post-id="' + esc(post.id) + '">' +
    '<span class="status ' + esc(post.status) + '">' + statusLabel + '</span>' +
    image +
    '<p class="post-title">' + esc(title) + '</p>' +
    '<p class="post-meta">' + esc(campaignName) + ' · ' + esc(dateLabel) + '</p>' +
    '<p>' + esc(post.caption || post.content || '') + '</p>' +
    error +
    (actions ? '<div class="actions">' + actions + '</div>' : '') +
    '<p class="action-feedback" aria-live="polite"></p>' +
    '</article>';
}

async function runImageAction(postId, button, action) {
  const card = button.closest('.post-card');
  const feedback = card && card.querySelector('.action-feedback');
  if (action === 'reject' && !confirm('Reject and delete this post? This cannot be undone.')) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = action === 'back-to-generated' ? 'Moving…' : 'Working…';
  if (feedback) {
    feedback.classList.remove('error');
    feedback.textContent = 'Working…';
  }
  try {
    const result = await api(POSTS_API + '/' + encodeURIComponent(postId) + '/' + action, {
      method: 'POST',
      body: '{}'
    });
    if (action === 'reject' && result.deleted && card) card.remove();
    await loadPosts();
  } catch (err) {
    if (feedback) {
      feedback.classList.add('error');
      feedback.textContent = 'Could not ' + action.replace(/-/g, ' ') + ': ' + err.message;
    }
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function postAction(id, action, evt) {
  if (action === 'reject' && !confirm('Reject and delete this post? This cannot be undone.')) {
    return;
  }
  return withBusy(btnOf(evt), async function () {
    await api(POSTS_API + '/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
    await loadPosts();
  });
}

// ===== EDIT TEXT =====
function openImageEditor(postId, button) {
  const post = postsCache.find(function (p) {
    return String(p.id) === String(postId);
  });
  if (!post) {
    alert('Post not found');
    return;
  }
  if (post.status && post.status !== 'generated') {
    alert('Only generated image posts can be edited');
    return;
  }

  const card = button && button.closest('.post-card');
  const feedback = card && card.querySelector('.action-feedback');
  const originalLabel = button && button.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Opening…';
  }
  if (feedback) {
    feedback.classList.remove('error');
    feedback.textContent = 'Opening editor…';
  }
  const win = window.open('', '_blank');
  api(POSTS_API + '/' + encodeURIComponent(post.id) + '/edit-link', { method: 'POST' })
    .then(function (d) {
      if (win) win.location.href = d.url;
      else window.open(d.url, '_blank');
      if (feedback) feedback.textContent = 'Edit the image and save; it will move to Ready to Post.';
    })
    .catch(function (err) {
      if (win) win.close();
      if (feedback) {
        feedback.classList.add('error');
        feedback.textContent = 'Could not open editor: ' + err.message;
      } else {
        alert('Error: ' + err.message);
      }
    })
    .finally(function () {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') loadPosts();
});

// ===== THEMES LOADER =====
async function loadThemes() {
  const sel = $('campaignSelect');
  if (!sel || !sel.value) return;
  try {
    const data = await api(CAMPAIGNS_API + '/' + encodeURIComponent(sel.value) + '/themes');
    const list = Array.isArray(data) ? data : ((data && data.themes) || []);
    if ($('themesInput')) {
      $('themesInput').value = list.map(function (t) {
        return typeof t === 'string' ? t : (t.theme || t.text || t.title || '');
      }).filter(Boolean).join('\n');
    }
  } catch (err) {}
}

// ===== ONBOARDING =====
const onboard = { connected: false, campaigns: 0, posts: 0, approved: false, approvedCount: 0 };

function setStat(id, v) { const e = $(id); if (e) e.textContent = v; }

function obHidden() {
  try { return localStorage.getItem('onboardingHidden') === '1'; } catch (e) { return false; }
}
function obSetHidden(v) {
  try { localStorage.setItem('onboardingHidden', v ? '1' : '0'); } catch (e) {}
  updateOnboarding();
}

function scrollToSection(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('pulse');
  setTimeout(function () { el.classList.remove('pulse'); }, 1800);
}
function goToSection(id) {
  const el = $(id);
  if (!el) return;
  if (typeof currentPage === 'function' && currentPage() !== 'main') {
    pendingScroll = function () { scrollToSection(el); };
    window.location.hash = '#/main';
    return;
  }
  scrollToSection(el);
}

function updateOnboarding() {
  setStat('statIG', onboard.connected ? 'Connected' : 'Not connected');
  setStat('statCampaigns', onboard.campaigns);
  setStat('statPosts', onboard.posts);
  setStat('statApproved', onboard.approvedCount);
  const box = $('onboarding');
  if (!box) return;
  const steps = [
    { title: 'Connect your Instagram', desc: 'Use a Business or Creator account linked to a Facebook Page.', done: onboard.connected, target: 'sec-connect', btn: 'Connect' },
    { title: 'Create your first campaign', desc: 'Tell us about your product, audience and tone.', done: onboard.campaigns > 0, target: 'sec-campaign', btn: 'Start' },
    { title: 'Generate your first post', desc: 'Pick a campaign and let AI write the ad.', done: onboard.posts > 0, target: 'sec-generate', btn: 'Generate' },
    { title: 'Approve a post', desc: 'Review it, approve it, then schedule publishing.', done: onboard.approved, target: 'sec-review', btn: 'Review' }
  ];
  const doneCount = steps.filter(function (s) { return s.done; }).length;
  const allDone = doneCount === steps.length;

  if (obHidden()) {
    box.style.display = 'block';
    box.innerHTML = '<button class="ob-link" onclick="obSetHidden(false)">Show getting-started guide (' + doneCount + '/4 done)</button>';
    return;
  }
  box.style.display = 'block';
  const next = steps.findIndex(function (s) { return !s.done; });
  box.innerHTML =
    '<h2>' + (allDone ? '🎉 You\'re all set!' : '🚀 Get started in 4 steps') + '</h2>' +
    '<span class="settings-note">' + doneCount + ' of 4 completed</span>' +
    '<div class="ob-bar"><div style="width:' + (doneCount * 25) + '%"></div></div>' +
    steps.map(function (s, i) {
      const cls = s.done ? 'done' : (i === next ? 'next' : '');
      return '<div class="ob-step ' + cls + '"><div class="ob-icon">' + (s.done ? '✅' : (i === next ? '👉' : '⬜')) + '</div>' +
        '<div class="ob-text"><b>' + (i + 1) + '. ' + esc(s.title) + '</b><span>' + esc(s.desc) + '</span></div>' +
        (s.done ? '' : '<button onclick="goToSection(\'' + s.target + '\')">' + esc(s.btn) + '</button>') + '</div>';
    }).join('') +
    '<button class="ob-link" onclick="obSetHidden(true)">Hide this guide</button>';
}

// ===== THEME =====
function currentTheme() {
  try { return localStorage.getItem('theme') || 'dark'; } catch (e) { return 'dark'; }
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const b = $('themeBtn');
  if (b) b.textContent = t === 'light' ? 'Switch to Midnight' : 'Switch to Daylight';
}
function toggleTheme() {
  const t = currentTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('theme', t); } catch (e) {}
  applyTheme(t);
}
applyTheme(currentTheme());

// ===== PAGES =====
var pendingScroll = null;

function currentPage() {
  const v = window.location.hash.replace(/^#\/?/, '');
  return ['brand', 'calendar', 'insights'].indexOf(v) > -1 ? v : 'main';
}

function showPage(name) {
  document.querySelectorAll('[data-view]').forEach(function (v) {
    v.classList.toggle('on', v.dataset.view === name);
  });
  document.querySelectorAll('.nav a[data-nav]').forEach(function (a) {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('kwik:page', { detail: name }));
}

window.addEventListener('hashchange', function () {
  showPage(currentPage());
  if (pendingScroll) {
    const f = pendingScroll;
    pendingScroll = null;
    setTimeout(f, 30);
  }
});

function goHome() {
  if (currentPage() !== 'main') window.location.hash = '#/main';
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', function () {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeClaim();
  });
  const sel = $('campaignSelect');
  if (sel) sel.addEventListener('change', function () {
    localStorage.setItem(SELECTED_CAMPAIGN_KEY, sel.value);
    loadThemes();
  });
  const section = new URLSearchParams(window.location.search).get('section');
  if (section) setTimeout(function () { goToSection(section); }, 100);
});

async function loadPhotoPicker() {
  const sel = $('genPhoto');
  if (!sel) return;
  const current = sel.value;
  try {
    const rows = await api('/api/library');
    const list = Array.isArray(rows) ? rows : [];
    sel.innerHTML = '<option value="">Auto (next in rotation)</option>' +
      list.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.title) + '</option>';
      }).join('');
    if (current) sel.value = current;
  } catch (err) {
    sel.innerHTML = '<option value="">Auto (next in rotation)</option>';
  }
}

loadPhotoPicker();

// ===== INIT =====
showPage(currentPage());
checkInstagramStatus();
updateOnboarding();
loadCampaigns().then(loadThemes);
loadPosts();