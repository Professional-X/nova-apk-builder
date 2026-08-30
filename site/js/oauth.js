// =============================================================
// OAuth Device Flow — no redirect, no backend, no secrets in browser
// Only the Client ID (which is public) is needed.
// =============================================================

const OAuth = {
  _pollTimer: null,

  async start() {
    if (!CONFIG.OAUTH_CLIENT_ID) {
      OAuth._showSetupGuide();
      return;
    }

    const statusEl = document.getElementById('oauth-status');
    const btn = document.getElementById('btn-connect');
    btn.disabled = true;
    statusEl.innerHTML = 'Requesting GitHub authorization…';

    try {
      // Step 1 — request device code
      const resp = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: CONFIG.OAUTH_CLIENT_ID,
          scope: 'public_repo repo:status'
        })
      });
      const data = await resp.json();

      if (data.error) {
        statusEl.innerHTML = '<span style="color:#f85149">Error: ' + escHtml(data.error_description || data.error) + '</span>';
        btn.disabled = false;
        return;
      }

      const { device_code, user_code, verification_uri, expires_in, interval } = data;

      // Step 2 — show code to user
      statusEl.innerHTML =
        '<p>1. Open this link in a new tab:</p>' +
        '<p><a href="' + verification_uri + '" target="_blank" rel="noopener" style="color:#58a6ff;word-break:break-all">' + verification_uri + '</a></p>' +
        '<p>2. Enter this code:</p>' +
        '<div class="oauth-code">' + user_code + '</div>' +
        '<p id="oauth-wait">Waiting for you to authorize…</p>';

      // Step 3 — poll for token
      OAuth._pollForToken(device_code, interval || 5, expires_in || 900, btn, statusEl);

    } catch (e) {
      statusEl.innerHTML = '<span style="color:#f85149">Network error. Check your connection and try again.</span>';
      btn.disabled = false;
    }
  },

  _pollForToken(device_code, interval, expires_in, btn, statusEl) {
    const deadline = Date.now() + expires_in * 1000;
    let attempts = 0;

    function poll() {
      if (Date.now() > deadline) {
        statusEl.innerHTML += '<br><span style="color:#f85149">Authorization timed out. Please try again.</span>';
        btn.disabled = false;
        return;
      }

      fetch('https://github.com/login/device/code', {  // reuse endpoint with grant_type
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: CONFIG.OAUTH_CLIENT_ID,
          device_code: device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
      .then(r => r.json())
      .then(data => {
        attempts++;
        if (data.access_token) {
          sessionStorage.setItem('gh_token', data.access_token);
          statusEl.innerHTML = '<span style="color:#3fb950">✓ Connected!</span>';
          btn.textContent = '✓ GitHub Connected';
          btn.disabled = true;
          setTimeout(() => showBuildUI(), 500);
          return;
        }
        if (data.error === 'authorization_pending') {
          OAuth._pollTimer = setTimeout(poll, interval * 1000);
          return;
        }
        // other errors
        let msg = data.error_description || data.error || 'Unknown error';
        statusEl.innerHTML += '<br><span style="color:#f85149">' + escHtml(msg) + '</span>';
        btn.disabled = false;
      })
      .catch(() => {
        if (attempts < 10) {
          OAuth._pollTimer = setTimeout(poll, interval * 1000);
        } else {
          statusEl.innerHTML += '<br><span style="color:#f85149">Network error. Please try again.</span>';
          btn.disabled = false;
        }
      });
    }

    OAuth._pollTimer = setTimeout(poll, interval * 1000);
  },

  _showSetupGuide() {
    const statusEl = document.getElementById('oauth-status');
    statusEl.innerHTML =
      '<div style="background:#1c1508;border:1px solid #9e6a03;border-radius:8px;padding:14px;font-size:0.85rem;color:#d29922;line-height:1.6">' +
      '<strong>⚠ One-time setup required</strong><br><br>' +
      '1. Go to <a href="https://github.com/settings/developers" target="_blank" style="color:#58a6ff">github.com/settings/developers</a><br>' +
      '2. Click <strong>New OAuth App</strong><br>' +
      '3. Fill in:<br>' +
      '&nbsp;&nbsp;Name: <code>Nova APK Builder</code><br>' +
      '&nbsp;&nbsp;Homepage: <code>https://professional-x.github.io/nova-apk-builder/</code><br>' +
      '&nbsp;&nbsp;Callback: <code>https://professional-x.github.io/nova-apk-builder/</code><br>' +
      '4. Click <strong>Register application</strong><br>' +
      '5. Copy the <strong>Client ID</strong> at the top<br>' +
      '6. Tell me the Client ID and I will add it to the code for you.<br><br>' +
      '<small>Why? The website uses GitHub’s OAuth Device Flow so your personal access token is never exposed in the browser.</small>' +
      '</div>';
  },

  getToken() {
    return sessionStorage.getItem('gh_token');
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  logout() {
    sessionStorage.removeItem('gh_token');
    location.reload();
  }
};

function startOAuth() { OAuth.start(); }

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}