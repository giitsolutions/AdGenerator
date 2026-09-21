const CAMPAIGNS_API = '/api/campaigns';
const POSTS_API = '/api/posts';
const AUTH_API = '/api/auth';

// TEMPORARY: login is disabled for now (see middleware/authMiddleware.js).
// Every request is treated as the same single local account, so no
// token is actually required — these helpers are kept as harmless
// no-ops so re-enabling login later just means restoring their real
// versions instead of rewriting every fetch() call in this file.
function authHeaders(extra = {}) {
  return { ...extra };
}

async function handleAuthFailure(res) {
  return false;
}

// --- Campaigns ---
async function createCampaign() {
  const body = {
    productName: document.getElementById('productName').value,
    audience: document.getElementById('audience').value,
    tone: document.getElementById('tone').value,
    offerDetails: document.getElementById('offerDetails').value,
    website: document.getElementById('website').value,
    logoUrl: document.getElementById('logoUrl').value
  };

  const res = await fetch(CAMPAIGNS_API, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (await handleAuthFailure(res)) return;

  loadCampaigns();
}

async function loadCampaigns() {
  const res = await fetch(CAMPAIGNS_API, { headers: authHeaders() });
  if (await handleAuthFailure(res)) return;
  const campaigns = await res.json();
  const select = document.getElementById('campaignSelect');
  select.innerHTML = campaigns
    .map(c => `<option value="${c.id}">${c.product_name} (#${c.id})</option>`)
    .join('');
}

async function generatePost() {
  const campaignId = document.getElementById('campaignSelect').value;
  if (!campaignId) return alert('Create a campaign first');

  const res = await fetch(`${CAMPAIGNS_API}/${campaignId}/generate`, {
    method: 'POST',
    headers: authHeaders()
  });
  if (await handleAuthFailure(res)) return;
  const data = await res.json();

  if (data.error) return alert('Error: ' + data.error);
  loadPosts();
}

// --- Daily theme queue (for the currently selected campaign) ---
async function saveThemes() {
  const campaignId = document.getElementById('campaignSelect').value;
  if (!campaignId) return alert('Select or create a campaign first');

  const themes = document.getElementById('themesInput').value;
  const res = await fetch(`${CAMPAIGNS_API}/${campaignId}/themes`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ themes })
  });
  if (await handleAuthFailure(res)) return;
  const data = await res.json();

  const statusEl = document.getElementById('themesStatus');
  if (data.error) {
    statusEl.textContent = `Error: ${data.error}`;
  } else {
    statusEl.textContent = `✅ ${data.message}. One will be used automatically each day — check your email for approval requests.`;
    document.getElementById('themesInput').value = '';
  }
}

async function loadPosts() {
  const res = await fetch(POSTS_API, { headers: authHeaders() });
  if (await handleAuthFailure(res)) return;
  const posts = await res.json();
  const container = document.getElementById('postsList');

  if (posts.length === 0) {
    container.innerHTML = '<p>No posts yet. Generate one above.</p>';
    return;
  }

  container.innerHTML = posts.map(p => `
    <div class="post-card">
      <span class="status ${p.status}">${p.status}</span>
      ${p.image_url ? `<img src="${p.image_url}" alt="Generated ad" style="width:100%; max-width:300px; border-radius:6px; margin:8px 0; display:block;" />` : ''}
      <p><strong>Caption:</strong> ${p.caption}</p>
      <p><strong>Hashtags:</strong> ${JSON.parse(p.hashtags).join(' ')}</p>
      <p><strong>CTA:</strong> ${p.cta}</p>
      ${p.status === 'draft' ? `
        <div class="actions">
          <button onclick="approvePost(${p.id})">✅ Approve & Post</button>
          <button onclick="rejectPost(${p.id})">❌ Reject</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function approvePost(id) {
  const res = await fetch(`${POSTS_API}/${id}/approve`, { method: 'POST', headers: authHeaders() });
  if (await handleAuthFailure(res)) return;
  const data = await res.json();
  if (data.error) return alert('Error: ' + data.error);
  loadPosts();
}

async function rejectPost(id) {
  const res = await fetch(`${POSTS_API}/${id}/reject`, { method: 'POST', headers: authHeaders() });
  if (await handleAuthFailure(res)) return;
  loadPosts();
}

loadCampaigns();
loadPosts();
setInterval(loadPosts, 10000);
