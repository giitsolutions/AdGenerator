
/*
 * Just-in-time Instagram Connect
 *
 * Load BEFORE app.js:
 * <script src="instagram-connect.js"></script>
 *
 * Features:
 * 1. Detects 409 INSTAGRAM_NOT_CONNECTED responses.
 * 2. Opens the Instagram connection popup.
 * 3. Starts Facebook OAuth using the existing backend.
 * 4. Handles success, cancellation, and errors.
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
    .ig-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 16px;
    }

    .ig-modal[hidden] {
      display: none;
    }

    .ig-modal-card {
      background: var(--panel, #fff);
      color: var(--text, #222);
      border: 1px solid var(--line, #ddd);
      padding: 24px;
      border-radius: 16px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
    }

    .ig-modal-card h3 {
      margin: 0 0 8px;
      font-size: 18px;
    }

    .ig-modal-card p {
      margin: 0 0 12px;
      line-height: 1.45;
      color: var(--soft, #555);
    }

    .ig-modal-actions {
      display: flex;
      gap: 10px;
      margin: 16px 0 10px;
      flex-wrap: wrap;
    }

    .ig-modal-actions button {
      cursor: pointer;
      padding: 10px 16px;
      border-radius: 8px;
    }

    .ig-modal-card small {
      color: var(--soft, #666);
    }

    .post-highlight {
      outline: 3px solid #f97316;
      outline-offset: 4px;
      border-radius: 14px;
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

  modal.innerHTML = `
    <div
      class="ig-modal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="igModalTitle"
    >
      <h3 id="igModalTitle">
        Connect Instagram to publish
      </h3>

      <p>
        Your post is saved and ready.
        Connect your Instagram Business or Creator
        account, then come back and schedule your post.
      </p>

      <div class="ig-modal-actions">
        <button type="button" id="igConnectBtn">
          Connect Instagram
        </button>

        <button
          type="button"
          id="igCancelBtn"
          class="btn-secondary"
        >
          Not now
        </button>
      </div>

      <small>
        Your Instagram account must be a Business or
        Creator account linked to a Facebook Page.
      </small>
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
    document.addEventListener(
      'DOMContentLoaded',
      mountModal
    );
  }

  // ----------------------------------------
  // Show / hide modal
  // ----------------------------------------

  var pendingPostId = null;

  function showConnectModal(postId) {
    pendingPostId = postId || null;
    mountModal();
    modal.hidden = false;
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

  modal
    .querySelector('#igCancelBtn')
    .addEventListener('click', hideConnectModal);

  // ----------------------------------------
  // Start Facebook OAuth
  // ----------------------------------------

  function startInstagramConnect(postId) {
    var btn = modal.querySelector('#igConnectBtn');

    if (btn.disabled) {
      return;
    }

    btn.disabled = true;

    try {
      var token = getToken();

      if (!token) {
        throw new Error(
          'Please log in before connecting Instagram.'
        );
      }

      var selectedPostId =
        postId || pendingPostId || null;

      // Save the post ID before leaving the dashboard.
      // The backend must explicitly support restoring it
      // after OAuth if that behavior is required.
      if (selectedPostId) {
        sessionStorage.setItem(
          'instagram_pending_post_id',
          String(selectedPostId)
        );
      }

      /*
       * FIX:
       *
       * Old endpoint:
       * POST /api/instagram/connect-url
       *
       * Existing backend endpoint:
       * GET /api/instagram/auth/start
       *
       * startConnect() generates the Facebook
       * authorization URL and redirects the browser.
       */

      var authUrl =
        '/api/instagram/auth/start?token=' +
        encodeURIComponent(token);

      window.location.assign(authUrl);

    } catch (error) {
      btn.disabled = false;

      console.error(
        '[Instagram Connect] OAuth start failed:',
        error
      );

      notify(
        error.message ||
        'Could not start Instagram connection.'
      );
    }
  }

  window.startInstagramConnect = startInstagramConnect;

  // ----------------------------------------
  // Connect button handler
  // ----------------------------------------

  modal
    .querySelector('#igConnectBtn')
    .addEventListener('click', function () {
      startInstagramConnect(pendingPostId);
    });

  // ----------------------------------------
  // Detect Instagram connection errors
  // ----------------------------------------

  window.fetch = async function () {
    var response = await originalFetch.apply(
      null,
      arguments
    );

    if (response.status === 409) {
      try {
        var data = await response.clone().json();

        if (
          data &&
          data.code === 'INSTAGRAM_NOT_CONNECTED'
        ) {
          showConnectModal(data.postId || null);
        }

      } catch (error) {
        console.warn(
          '[Instagram Connect] Could not parse 409 response:',
          error
        );
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
      var cards = document.querySelectorAll(
        '[data-post-id]'
      );

      var card = Array.prototype.find.call(
        cards,
        function (element) {
          return element.getAttribute('data-post-id') ===
            String(postId);
        }
      );

      if (card) {
        clearInterval(timer);

        card.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });

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
  // Handle return from Facebook OAuth
  // ----------------------------------------

  function handleInstagramReturn() {
    var connected =
      initialParams.has('instagram_connected');

    var cancelled =
      initialParams.has('instagram_cancelled');

    var errorMessage =
      initialParams.get('instagram_error');

    var hasReturnResult =
      connected || cancelled || !!errorMessage;

    if (!hasReturnResult) {
      return;
    }

    var postId = initialParams.get('postId');

    // Fallback to the post selected before OAuth.
    if (!postId) {
      postId = sessionStorage.getItem(
        'instagram_pending_post_id'
      );
    }

    sessionStorage.removeItem(
      'instagram_pending_post_id'
    );

    var hasBanner = !!document.getElementById(
      'igSuccessBanner'
    );

    if (cancelled) {
      notify(
        'Instagram connection cancelled. Your post is still saved.'
      );

    } else if (!hasBanner) {
      if (connected) {
        notify(
          'Instagram connected. Now schedule your post.'
        );

      } else if (errorMessage) {
        notify(errorMessage);
      }
    }

    if (postId) {
      highlightPost(postId);
    }
  }

  // ----------------------------------------
  // Initialize OAuth return handling
  // ----------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      handleInstagramReturn
    );
  } else {
    handleInstagramReturn();
  }

})();
