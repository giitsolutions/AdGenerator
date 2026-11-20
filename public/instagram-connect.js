/*
 * Just-in-time Instagram Connect
 *
 * Load BEFORE app.js (and before schedule.js):
 *   <script src="instagram-connect.js"></script>
 *
 * Features:
 * 1. Detects 409 INSTAGRAM_NOT_CONNECTED (from Approve, Schedule, Retry).
 * 2. Opens the "Connect Instagram" popup.
 * 3. Starts Facebook OAuth:
 *      - preferred:  POST /api/instagram/connect-url  (secure, remembers the
 *                    post and the page to return to)
 *      - fallback:   GET  /api/instagram/auth/start?token=...  (only used if the
 *                    new endpoint does not exist yet, i.e. an old backend)
 * 4. Handles success, cancellation, errors and email "approve" links.
 * 5. Highlights the original post after returning.
 */
(function () {
  'use strict';

  // Capture OAuth return parameters before app.js changes the URL.
  var initialParams = new URLSearchParams(window.location.search);

  // Preserve the original fetch implementation.
  var originalFetch = window.fetch.bind(window);

  // ----------------------------------------
  // Authentication token
  // ----------------------------------------
  function getToken() {
    return (
      localStorage.getItem('token') ||
      localStorage.getItem('jwt') ||
      localStorage.getItem('authToken') ||
      localStorage.getItem('kwikpost_token') ||
      ''
    );
  }

  // ----------------------------------------
  // Notifications
  // ----------------------------------------
  function notify(message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else {
      alert(message);
    }
  }

  // ----------------------------------------
  // Modal styling
  // ----------------------------------------
  var style = document.createElement('style');
  style.textContent = `
    /* Self-contained: does not depend on any page colours or button styles */
    .ig-modal {
      --igm-bg: #0f0e15;
      --igm-text: #f5f2ff;
      --igm-soft: #aaa2c9;
      --igm-line: #2b2740;
      --igm-row: #17151f;
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(5, 4, 10, 0.62);
      -webkit-backdrop-filter: blur(6px);
      backdrop-filter: blur(6px);
      font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
      animation: igmFade .18s ease-out;
    }
    :root[data-theme="light"] .ig-modal {
      --igm-bg: #ffffff;
      --igm-text: #1e1b2e;
      --igm-soft: #6a6483;
      --igm-line: #e6e0f2;
      --igm-row: #f5f2fb;
      background: rgba(30, 27, 46, 0.45);
    }
    .ig-modal[hidden] { display: none; }

    .ig-modal-card {
      position: relative;
      width: 100%;
      max-width: 440px;
      padding: 30px 28px 24px;
      border-radius: 22px;
      border: 1.5px solid transparent;
      background:
        linear-gradient(var(--igm-bg), var(--igm-bg)) padding-box,
        linear-gradient(135deg, #f97316, #ec4899 50%, #a855f7) border-box;
      color: var(--igm-text);
      text-align: center;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5), 0 0 70px rgba(168, 85, 247, 0.22);
      animation: igmPop .22s cubic-bezier(.2, .9, .3, 1.2);
    }

    .ig-modal .ig-close {
      all: unset;
      position: absolute;
      top: 14px;
      right: 14px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--igm-soft);
      cursor: pointer;
      transition: background .15s, color .15s;
    }
    .ig-modal .ig-close:hover { background: var(--igm-row); color: var(--igm-text); }
    .ig-modal .ig-close:focus-visible { outline: 2px solid #f97316; }

    .ig-modal .ig-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 30% 105%, #fdc468 0%, #f58529 22%, #dd2a7b 52%, #8134af 78%, #515bd4 100%);
      box-shadow: 0 10px 28px rgba(221, 42, 123, 0.38);
    }

    .ig-modal .ig-title {
      display: block;
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.01em;
      color: var(--igm-text);
    }
    .ig-modal .ig-sub {
      display: block;
      margin: 0 auto 20px;
      max-width: 340px;
      font-size: 14.5px;
      line-height: 1.55;
      color: var(--igm-soft);
    }

    .ig-modal .ig-steps {
      list-style: none;
      margin: 0 0 22px;
      padding: 0;
      text-align: left;
    }
    .ig-modal .ig-steps li {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 0 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--igm-row);
      border: 1px solid var(--igm-line);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--igm-text);
    }
    .ig-modal .ig-steps li.is-now {
      border-color: rgba(249, 115, 22, 0.65);
      background: rgba(249, 115, 22, 0.1);
    }
    .ig-modal .ig-steps .ig-dot {
      flex: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      color: #fff;
      background: linear-gradient(135deg, #f97316, #a855f7);
    }
    .ig-modal .ig-steps li.is-done .ig-dot { background: #2fcf94; }
    .ig-modal .ig-steps li.is-done { color: var(--igm-soft); }

    .ig-modal .ig-btn-primary {
      all: unset;
      box-sizing: border-box;
      width: 100%;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      border-radius: 14px;
      background: linear-gradient(135deg, #f97316 0%, #ec4899 55%, #a855f7 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 26px rgba(236, 72, 153, 0.35);
      transition: transform .12s, filter .15s, box-shadow .15s;
    }
    .ig-modal .ig-btn-primary:hover { filter: brightness(1.08); box-shadow: 0 14px 32px rgba(236, 72, 153, 0.45); }
    .ig-modal .ig-btn-primary:active { transform: translateY(1px); }
    .ig-modal .ig-btn-primary:focus-visible { outline: 3px solid rgba(249, 115, 22, 0.55); outline-offset: 2px; }
    .ig-modal .ig-btn-primary[disabled] { opacity: .65; cursor: progress; filter: none; }

    .ig-modal .ig-btn-ghost {
      all: unset;
      box-sizing: border-box;
      display: inline-block;
      margin-top: 8px;
      padding: 10px 18px;
      border-radius: 10px;
      color: var(--igm-soft);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: color .15s, background .15s;
    }
    .ig-modal .ig-btn-ghost:hover { color: var(--igm-text); background: var(--igm-row); }
    .ig-modal .ig-btn-ghost:focus-visible { outline: 2px solid #f97316; }

    .ig-modal .ig-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 14px 0 0;
      padding-top: 14px;
      border-top: 1px solid var(--igm-line);
      text-align: left;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--igm-soft);
    }
    .ig-modal .ig-note svg { flex: none; margin-top: 2px; }

    .post-highlight {
      outline: 3px solid #f97316;
      outline-offset: 4px;
      border-radius: 14px;
    }

    @keyframes igmFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes igmPop  { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) {
      .ig-modal, .ig-modal-card { animation: none; }
    }
    @media (max-width: 420px) {
      .ig-modal-card { padding: 26px 18px 20px; }
      .ig-modal .ig-title { font-size: 20px; }
    }
  `;
  document.head.appendChild(style);

  // ----------------------------------------
  // Create Instagram connection modal
  // ----------------------------------------
  var modal = document.createElement('div');
  modal.id = 'igModal';
  modal.className = 'ig-modal';
  modal.hidden = true;

  var CAMERA_SVG =
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="5"></rect>' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<circle cx="17.3" cy="6.7" r="1" fill="#fff" stroke="none"></circle></svg>';

  modal.innerHTML = `
    <div class="ig-modal-card" role="dialog" aria-modal="true" aria-labelledby="igModalTitle">
      <button type="button" class="ig-close" id="igCloseBtn" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>

      <div class="ig-icon">${CAMERA_SVG}</div>

      <span class="ig-title" id="igModalTitle">Connect Instagram to publish</span>
      <span class="ig-sub">
        Your draft is saved. Connect your Instagram account once,
        then press Approve again to publish.
      </span>

      <ul class="ig-steps">
        <li class="is-done"><span class="ig-dot">&#10003;</span>Draft saved</li>
        <li class="is-now"><span class="ig-dot">2</span>Connect your Instagram account</li>
        <li><span class="ig-dot">3</span>Press Approve to publish</li>
      </ul>

      <button type="button" class="ig-btn-primary" id="igConnectBtn">
        <span class="ig-btn-label">Connect Instagram</span>
      </button>
      <button type="button" class="ig-btn-ghost" id="igCancelBtn">Not now</button>

      <div class="ig-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>
        <span>Works with an Instagram Business or Creator account linked to a Facebook Page.
        Your draft stays saved if you skip this.</span>
      </div>
    </div>
  `;

  function mountModal() {
    if (!modal.isConnected) {
      document.body.appendChild(modal);
    }
  }

  if (document.body) {
    mountModal();
  } else {
    document.addEventListener('DOMContentLoaded', mountModal);
  }

  // ----------------------------------------
  // Show / hide modal
  // ----------------------------------------
  var pendingPostId = null;

  function setConnectLoading(isLoading) {
    var btn = modal.querySelector('#igConnectBtn');
    btn.disabled = isLoading;
    btn.querySelector('.ig-btn-label').textContent =
      isLoading ? 'Opening Instagram\u2026' : 'Connect Instagram';
  }

  function showConnectModal(postId) {
    pendingPostId = postId || null;
    mountModal();
    setConnectLoading(false);
    modal.hidden = false;
    try { modal.querySelector('#igConnectBtn').focus(); } catch (_) {}
  }

  function hideConnectModal() {
    modal.hidden = true;
  }

  window.showConnectModal = showConnectModal;

  modal.addEventListener('click', function (event) {
    if (event.target === modal) {
      hideConnectModal();
    }
  });

  modal.querySelector('#igCancelBtn').addEventListener('click', hideConnectModal);
  modal.querySelector('#igCloseBtn').addEventListener('click', hideConnectModal);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) {
      hideConnectModal();
    }
  });

  // ----------------------------------------
  // Start Facebook OAuth
  // ----------------------------------------
  async function startInstagramConnect(postId) {
    var btn = modal.querySelector('#igConnectBtn');

    if (btn.disabled) {
      return;
    }
    setConnectLoading(true);

    try {
      var token = getToken();
      if (!token) {
        throw new Error('Please log in before connecting Instagram.');
      }

      var selectedPostId = postId || pendingPostId || null;

      // Remember the post, in case the backend cannot carry it through OAuth.
      if (selectedPostId) {
        sessionStorage.setItem('instagram_pending_post_id', String(selectedPostId));
      }

      var returnTo =
        window.location.pathname.indexOf('reels') !== -1
          ? '/reels.html'
          : '/index.html';

      // Preferred: secure endpoint (token stays in the header, post is remembered)
      var res = await originalFetch('/api/instagram/connect-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({ postId: selectedPostId, returnTo: returnTo })
      });

      // Old backend without /connect-url: use the legacy start URL.
      if (res.status === 404) {
        console.warn(
          '[Instagram Connect] /connect-url not found, using legacy /auth/start. ' +
          'Update instagramAuthController.js and instagramAuthRoutes.js.'
        );
        window.location.assign(
          window.location.href = '/instagram-setup.html'
        );
        return;
      }

      if (res.status === 401) {
        throw new Error('Your session expired. Please log in again.');
      }

      var data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start Instagram connection.');
      }

      window.location.assign(data.url); // go to Facebook
    } catch (error) {
      setConnectLoading(false);
      console.error('[Instagram Connect] OAuth start failed:', error);
      notify(error.message || 'Could not start Instagram connection.');
    }
  }

  window.startInstagramConnect = startInstagramConnect;

  modal.querySelector('#igConnectBtn').addEventListener('click', function () {
    startInstagramConnect(pendingPostId);
  });

   // ----------------------------------------
  // Detect Instagram connection errors (409)
  // ----------------------------------------
  function isInstagramNotConnected(data) {
    if (!data) return false;
    var code =
      data.code ||
      data.errorCode ||
      (data.error && (data.error.code || data.error)) ||
      '';
    return String(code).toUpperCase() === 'INSTAGRAM_NOT_CONNECTED';
  }

  window.fetch = async function () {
    var response = await originalFetch.apply(null, arguments);

    if (response.status === 409) {
      try {
        var data = await response.clone().json();
        console.log('[Instagram Connect] 409 body:', data); // remove once working

        if (isInstagramNotConnected(data)) {
          showConnectModal(
            data.postId || (data.error && data.error.postId) || null
          );
        }
      } catch (error) {
        console.warn('[Instagram Connect] 409 body was not JSON:', error);
      }
    }

    return response;
  };

  // ----------------------------------------
  // Highlight the original post
  // ----------------------------------------
  function highlightPost(postId) {
    if (!postId) {
      return;
    }

    var tries = 0;
    var maxTries = 25;

    var timer = setInterval(function () {
      var cards = document.querySelectorAll('[data-post-id]');
      var card = Array.prototype.find.call(cards, function (element) {
        return element.getAttribute('data-post-id') === String(postId);
      });

      if (card) {
        clearInterval(timer);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('post-highlight');
        setTimeout(function () {
          card.classList.remove('post-highlight');
        }, 5000);
      } else if (++tries >= maxTries) {
        clearInterval(timer);
      }
    }, 300);
  }

  // ----------------------------------------
  // Handle return from Facebook / email link
  // ----------------------------------------
  function handleInstagramReturn() {
    var connected = initialParams.has('instagram_connected');
    var cancelled = initialParams.has('instagram_cancelled');
    var errorMessage = initialParams.get('instagram_error');
    var needsInstagram = initialParams.has('needs_instagram');

    var postId = initialParams.get('postId');

    // Came from an email Approve link while Instagram was not connected
    if (needsInstagram) {
      showConnectModal(postId ? Number(postId) : null);
    }

    if (!connected && !cancelled && !errorMessage && !needsInstagram) {
      return;
    }

    // Fall back to the post selected before OAuth.
    if (!postId && !needsInstagram) {
      postId = sessionStorage.getItem('instagram_pending_post_id');
    }
    if (!needsInstagram) {
      sessionStorage.removeItem('instagram_pending_post_id');
    }

    // The dashboard has its own green/red banners for connected / error.
    var hasBanner = !!document.getElementById('igSuccessBanner');

    if (cancelled) {
      notify('Instagram connection cancelled. Your post is still saved.');
    } else if (!hasBanner) {
      if (connected) {
        notify('Instagram connected. Now press Approve on your post.');
      } else if (errorMessage) {
        notify(errorMessage);
      }
    }

    highlightPost(postId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleInstagramReturn);
  } else {
    handleInstagramReturn();
  }
})();