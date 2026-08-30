// =============================================================
// GitHub API helpers — all calls use the token from sessionStorage
// =============================================================

var GitHubAPI = {

  // ---- helpers ----
  _headers: function() {
    return {
      'Authorization': 'Bearer ' + getToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  },

  _request: async function(method, path, body) {
    var url = CONFIG.API_BASE + path;
    var opts = { method: method, headers: this._headers() };
    if (body && method !== 'GET') {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    var resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      throw new Error('Network error — check your internet connection.');
    }

    var text = await resp.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!resp.ok) {
      var msg = '';
      if (data && typeof data === 'object' && data.message) {
        msg = data.message;
      } else {
        msg = 'GitHub API error (HTTP ' + resp.status + ')';
      }

      // Provide helpful hints for common errors
      if (resp.status === 401) {
        msg = 'Token is invalid or expired. Please re-enter your token.';
      } else if (resp.status === 403) {
        if (msg.indexOf('rate limit') !== -1) {
          msg = 'GitHub API rate limit hit. Wait a minute and try again.';
        } else {
          msg = 'Permission denied. Your token may lack the required scope.';
        }
      } else if (resp.status === 404 && path.indexOf('/repos/') !== -1 && path.indexOf('/releases') === -1) {
        msg = 'Resource not found. Check that the repository exists and your token has access.';
      } else if (resp.status === 422) {
        msg = 'Invalid request: ' + msg;
      }

      throw new Error(msg);
    }
    return data;
  },

  // ---- upload ZIP as release asset ----
  uploadZip: async function(file) {
    // Create a draft release
    var tag = 'build-' + Date.now();
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;

    var release;
    try {
      release = await this._request('POST',
        repoPath + '/releases',
        { tag_name: tag, name: tag, draft: true, body: 'APK build request' }
      );
    } catch (e) {
      throw new Error('Failed to create release on GitHub: ' + e.message);
    }

    // Upload ZIP as release asset (separate request — not JSON)
    var uploadUrl = release.upload_url.replace('{?name,label}', '?name=source.zip');

    var resp;
    try {
      resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getToken(),
          'Content-Type': 'application/zip'
        },
        body: file
      });
    } catch (e) {
      throw new Error('Network error while uploading file. Check your connection and try again.');
    }

    if (!resp.ok) {
      var errText = await resp.text().catch(function() { return 'Unknown error'; });
      var errMsg = 'Upload failed';
      try {
        var errJson = JSON.parse(errText);
        if (errJson.message) errMsg = errJson.message;
      } catch(e) {}
      if (resp.status === 413) {
        errMsg = 'File too large for upload. Maximum is ' + CONFIG.MAX_ZIP_MB + ' MB.';
      } else if (resp.status === 422) {
        errMsg = 'Upload rejected: ' + errMsg + '. The file may be too large or the release may be in an invalid state.';
      }
      throw new Error(errMsg);
    }

    return { releaseId: release.id, tag: tag, uploadUrl: release.html_url };
  },

  // ---- trigger build workflow ----
  triggerBuild: async function(releaseId, signingMode) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    try {
      return await this._request('POST',
        repoPath + '/actions/workflows/build-apk.yml/dispatches',
        { ref: 'main', inputs: { release_id: String(releaseId), signing_mode: signingMode } }
      );
    } catch (e) {
      if (e.message.indexOf('404') !== -1 || e.message.indexOf('not found') !== -1) {
        throw new Error('Build workflow not found. The repository may not have the build-apk.yml workflow file on the main branch.');
      }
      throw new Error('Failed to trigger build: ' + e.message);
    }
  },

  // ---- poll for latest workflow run ----
  getLatestRun: async function() {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    var data = await this._request('GET',
      repoPath + '/actions/workflows/build-apk.yml/runs?per_page=1'
    );
    if (data.workflow_runs && data.workflow_runs.length > 0) {
      return data.workflow_runs[0];
    }
    return null;
  },

  // ---- get release assets (to find APK) ----
  getReleaseAssets: async function(releaseId) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    return await this._request('GET', repoPath + '/releases/' + releaseId + '/assets');
  },

  // ---- update release (mark non-draft) ----
  updateRelease: async function(releaseId, body) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    return await this._request('PATCH', repoPath + '/releases/' + releaseId, body);
  }
};
