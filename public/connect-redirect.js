// Sends any "connect" action to the step-by-step setup page for that platform.
// Connected accounts are not affected.
(function () {
  var IG_SETUP = '/instagram-setup.html';
  var YT_SETUP = '/youtube-setup.html';

  // 1. Any code that calls the Instagram connect popup goes to the setup page instead
  window.startInstagramConnect = function () { window.location.href = IG_SETUP; };
  window.showConnectModal = function () { window.location.href = IG_SETUP; };

  // 2. Logo buttons and "Connect ..." buttons anywhere on the page.
  // The capture phase runs before the page's own click handlers, so they never run.
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;

    var ig = e.target.closest('#igConnectBtn');
    if (ig && ig.dataset.connected !== '1') {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = IG_SETUP;
      return;
    }

    var yt = e.target.closest('#ytConnectBtn');
    if (yt && yt.dataset.connected !== '1') {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = YT_SETUP;
      return;
    }

    // Buttons in the Post and Schedule popups, such as "Connect Instagram" or "Connect YouTube"
    var btn = e.target.closest('button');
    if (btn) {
      var text = (btn.textContent || '').trim();
      if (text === 'Connect Instagram') {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = IG_SETUP;
      } else if (text === 'Connect YouTube') {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.href = YT_SETUP;
      }
    }
  }, true);
})();