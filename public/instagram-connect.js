/* Just-in-time Instagram connect.
 * Load BEFORE app.js:   <script src="instagram-connect.js"></script>
 *
 *  1. Watches every fetch(). A 409 INSTAGRAM_NOT_CONNECTED reply (schedule /
 *     reschedule / retry) opens the "Connect Instagram" popup.
 *  2. Starts the Facebook OAuth flow (window.startInstagramConnect), also used
 *     by the Connect button in section 4 of the dashboard.
 *  3. After Facebook, handles "cancelled" and highlights the same post card.
 *     "connected" and "error" messages are left to the page's own banners.
 */
(function () {
  'use strict';

  // Read the return parameters immediately, before app.js can clean the URL.
  var initialParams = new URLSearchParams(window.location.search);

  var originalFetch = window.fetch.bind(window);

  function getToken() {
    return (
      localStorage.getItem('token') ||
      localStorage.getItem('jwt') ||
      localStorage.getItem('authToken') ||
      localStorage.getItem('kwikpost_token') ||
      ''
    );
  }

  function notify(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }

  // ---------- styles + modal ----------
  var style = document.createElement('style');
  style.textContent =
    '.ig-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:16px}' +
    '.ig-modal[hidden]{display:none}' +
    '.ig-modal-card{background:var(--panel,#fff);color:var(--text,#222);border:1px solid var(--line,#ddd);padding:24px;border-radius:16px;max-width:420px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.4)}' +
    '.ig-modal-card h3{margin:0 0 8px;font-size:18px}' +
    '.ig-modal-card p{margin:0 0 12px;line-height:1.45;color:var(--soft,#555)}' +
    '.ig-modal-actions{display:flex;gap:10px;margin:16px 0 10px;flex-wrap:wrap}' +
    '.ig-modal-card small{color:var(--soft,#666)}' +
    '.post-highlight{outline:3px solid #f97316;outline-offset:4px;border-radius:14px}';
  document.head.appendChild(style);

  var modal = document.createElement('div');
  modal.id = 'igModal';
  modal.className = 'ig-modal';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="ig-modal-card" role="dialog" aria-labelledby="igModalTitle">' +
    '<h3 id="igModalTitle">Connect Instagram to publish</h3>' +
    '<p>Your post is saved and ready. Connect your Instagram Business or Creator account, then come back and schedule your post.</p>' +
    '<div class="ig-modal-actions">' +
    '<button type="button" id="igConnectBtn">Connect Instagram</button>' +
    '<button type="button" id="igCancelBtn" class="btn-secondary">Not now</button>' +
    '</div>' +
    '<small>Your account must be a Business or Creator account linked to a Facebook Page.</small>' +
    '</div>';

  function mountModal() {
    document.body.appendChild(modal);
  }
  if (document.body) mountModal();
  else document.addEventListener('DOMContentLoaded', mountModal);

  var pendingPostId = null;

  function showConnectModal(postId) {
    pendingPostId = postId || null;
    modal.hidden = false;
  }
  function hideConnectModal() {
    modal.hidden = true;
  }
  window.showConnectModal = showConnectModal;

  modal.addEventListener('click', function (e) {
    if (e.target === modal) hideConnectModal();
  });
  modal.querySelector('#igCancelBtn').addEventListener('click', hideConnectModal);

  // ---------- start the Facebook flow ----------
  async function startInstagramConnect(postId) {
    var btn = modal.querySelector('#igConnectBtn');
    btn.disabled = true;
    try {
      var res = await originalFetch('/api/instagram/connect-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken()
        },
        body: JSON.stringify({ postId: postId || pendingPostId || null })
      });
      var data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'No URL returned');
      window.location.href = data.url; // go to Facebook
    } catch (e) {
      btn.disabled = false;
      notify('Could not start the Instagram connection. Please try again.');
    }
  }
  window.startInstagramConnect = startInstagramConnect;

  btnClick();
  function btnClick() {
    modal.querySelector('#igConnectBtn').addEventListener('click', function () {
      startInstagramConnect(pendingPostId);
    });
  }

  // ---------- catch 409 INSTAGRAM_NOT_CONNECTED from any fetch ----------
  window.fetch = async function () {
    var response = await originalFetch.apply(null, arguments);
    if (response.status === 409) {
      try {
        var data = await response.clone().json();
        if (data && data.code === 'INSTAGRAM_NOT_CONNECTED') {
          showConnectModal(data.postId);
        }
      } catch (_) { /* not JSON */ }
    }
    return response;
  };

  // ---------- return from Facebook ----------
  function handleInstagramReturn() {
    var postId = initialParams.get('postId');
    var hasBanner = !!document.getElementById('igSuccessBanner');

    if (initialParams.get('instagram_cancelled')) {
      notify('Instagram connection cancelled. Your post is still saved.');
    } else if (!hasBanner) {
      // Pages without banners get a simple message instead
      if (initialParams.get('instagram_connected')) {
        notify('Instagram connected. Now schedule your post.');
      } else if (initialParams.get('instagram_error')) {
        notify(initialParams.get('instagram_error'));
      }
    }

    // Scroll to and highlight the same post (cards need data-post-id)
    var returned = initialParams.get('instagram_connected') ||
                   initialParams.get('instagram_cancelled') ||
                   initialParams.get('instagram_error');
    if (postId && returned) {
      var tries = 0;
      var timer = setInterval(function () {
        var card = document.querySelector('[data-post-id="' + postId + '"]');
        if (card) {
          clearInterval(timer);
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('post-highlight');
          setTimeout(function () { card.classList.remove('post-highlight'); }, 5000);
        } else if (++tries > 25) {
          clearInterval(timer);
        }
      }, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleInstagramReturn);
  } else {
    handleInstagramReturn();
  }
})();