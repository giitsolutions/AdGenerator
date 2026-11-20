/* Instagram Connect popup. Load before reels page application code. */
(function () {
  'use strict';
  var originalFetch = window.fetch.bind(window);
  var params = new URLSearchParams(location.search);
  function token() {
    return localStorage.getItem('authToken') || localStorage.getItem('token') ||
      localStorage.getItem('jwt') || localStorage.getItem('kwikpost_token') || '';
  }
  function notify(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }
  var style = document.createElement('style');
  style.textContent = '.ig-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px}' +
    '.ig-modal[hidden]{display:none!important}.ig-modal-card{background:var(--card,#17151f);color:var(--text,#fff);border:1px solid var(--line,#444);border-radius:16px;padding:24px;max-width:440px;width:100%;box-shadow:0 20px 50px #0008}' +
    '.ig-modal-card h3{margin:0 0 10px;font-size:19px}.ig-modal-card p{line-height:1.5;color:var(--muted,#aaa)}' +
    '.ig-modal-actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.ig-modal-actions button{padding:10px 16px;border-radius:9px;cursor:pointer}' +
    '.ig-modal-card small{color:var(--muted,#aaa)}.post-highlight{outline:3px solid #f97316;outline-offset:3px}';
  document.head.appendChild(style);
  var modal = document.createElement('div');
  modal.id = 'igModal'; modal.className = 'ig-modal'; modal.hidden = true;
  modal.innerHTML = '<div class="ig-modal-card" role="dialog" aria-modal="true" aria-labelledby="igModalTitle">' +
    '<h3 id="igModalTitle">Connect Instagram to continue</h3>' +
    '<p>Connect your Instagram professional account before approving or scheduling a post or Reel. Your draft will remain saved.</p>' +
    '<div class="ig-modal-actions"><button type="button" id="igConnectBtn">Connect Instagram</button>' +
    '<button type="button" id="igCancelBtn">Not now</button></div>' +
    '<small>Use a supported Instagram professional account configured for publishing.</small></div>';
  function mount() { if (!modal.isConnected) document.body.appendChild(modal); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  var pendingPostId = null;
  var previousFocus = null;
  function hide() { modal.hidden = true; if (previousFocus && previousFocus.focus) previousFocus.focus(); }
  window.showConnectModal = function (postId) {
    pendingPostId = postId || null;
    previousFocus = document.activeElement;
    mount(); modal.hidden = false;
    modal.querySelector('#igConnectBtn').focus();
  };
  modal.addEventListener('click', function (event) { if (event.target === modal) hide(); });
  modal.querySelector('#igCancelBtn').addEventListener('click', hide);
  document.addEventListener('keydown', function (event) {
    if (!modal.hidden && event.key === 'Escape') hide();
  });
  async function startInstagramConnect(postId) {
    var button = modal.querySelector('#igConnectBtn');
    button.disabled = true;
    try {
      if (!token()) { location.href = '/login.html'; return; }
      // Existing backend route is GET /api/instagram/auth/start.
      // Some controllers redirect immediately; others return JSON {url}.
      var url = '/instagram-setup.html';
// then something like:
window.location.href = url;
      var id = postId || pendingPostId;
      if (id != null) url += '&postId=' + encodeURIComponent(id);
      // Navigate to let the OAuth endpoint redirect to Facebook.
      location.assign(url);
    } catch (err) {
      button.disabled = false;
      console.error('[Instagram] OAuth start failed', err);
      notify('Could not start Instagram connection.');
    }
  }
  window.startInstagramConnect = startInstagramConnect;
  modal.querySelector('#igConnectBtn').addEventListener('click', function () {
    startInstagramConnect(pendingPostId);
  });
  // Safety net: a backend 409 response should open the popup, even for
  // requests made by other scripts such as schedule-calendar.js.
  window.fetch = async function () {
    var response = await originalFetch.apply(null, arguments);
    if (response.status === 409) {
      try {
        var data = await response.clone().json();
        if (data && data.code === 'INSTAGRAM_NOT_CONNECTED') {
          window.showConnectModal(data.postId || null);
        }
      } catch (_) { /* non-JSON response */ }
    }
    return response;
  };
  function handleReturn() {
    if (params.has('instagram_cancelled')) notify('Instagram connection cancelled. Your draft is saved.');
    else if (params.has('instagram_connected')) notify('Instagram connected. You can now approve your Reel.');
    else if (params.has('instagram_error')) notify(params.get('instagram_error') || 'Instagram connection failed.');
    var id = params.get('postId');
    if (id && (params.has('instagram_connected') || params.has('instagram_cancelled') || params.has('instagram_error'))) {
      var count = 0;
      var timer = setInterval(function () {
        var card = Array.from(document.querySelectorAll('[data-post-id]')).find(function (el) {
          return el.dataset.postId === id;
        });
        if (card) {
          clearInterval(timer);
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('post-highlight');
          setTimeout(function () { card.classList.remove('post-highlight'); }, 5000);
        } else if (++count > 30) clearInterval(timer);
      }, 300);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', handleReturn);
  else handleReturn();
})();