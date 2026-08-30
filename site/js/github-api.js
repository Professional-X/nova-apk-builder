// =============================================================
// GitHub API helpers — all calls go through api.github.com (CORS safe)
// uploads.github.com is NOT used from the browser (CORS blocked)
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
      throw new Error('Network error — check your internet connection and try again.');
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
      if (resp.status === 401) {
        msg = 'Token is invalid or expired. Please re-enter your token.';
      } else if (resp.status === 403) {
        if (msg.indexOf('rate limit') !== -1) {
          msg = 'GitHub API rate limit hit. Wait a minute and try again.';
        } else {
          msg = 'Permission denied. Your token may lack the required scope.';
        }
      }
      throw new Error(msg);
    }
    return data;
  },

  // ---- Upload ZIP as a Git blob (avoids uploads.github.com CORS issue) ----
  uploadZip: async function(file) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;

    // Step 1: Create a draft release for the output
    var tag = 'build-' + Date.now();
    var release;
    try {
      release = await this._request('POST', repoPath + '/releases', {
        tag_name: tag, name: tag, draft: true, body: 'APK build in progress...'
      });
    } catch (e) {
      throw new Error('Failed to create release: ' + e.message);
    }

    // Step 2: Read file as base64 and upload as Git blob via api.github.com
    var base64;
    try {
      base64 = await this._readFileAsBase64(file);
    } catch (e) {
      throw new Error('Failed to read file: ' + e.message);
    }

    var blob;
    try {
      blob = await this._request('POST', repoPath + '/git/blobs', {
        content: base64,
        encoding: 'base64'
      });
    } catch (e) {
      throw new Error('Failed to upload file to GitHub: ' + e.message);
    }

    return {
      releaseId: release.id,
      blobSha: blob.sha,
      tag: tag
    };
  },

  _readFileAsBase64: function(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        // reader.result is like "data:application/zip;base64,XXXXX"
        var base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = function() {
        reject(new Error('Could not read file'));
      };
      reader.readAsDataURL(file);
    });
  },

  // ---- trigger build workflow ----
  triggerBuild: async function(releaseId, blobSha, signingMode) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    try {
      return await this._request('POST',
        repoPath + '/actions/workflows/build-apk.yml/dispatches',
        { ref: 'main', inputs: {
          release_id: String(releaseId),
          blob_sha: blobSha,
          signing_mode: signingMode
        }}
      );
    } catch (e) {
      if (e.message.indexOf('404') !== -1 || e.message.indexOf('not found') !== -1) {
        throw new Error('Build workflow not found on the main branch.');
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

  // ---- get release assets (to find APK download links) ----
  getReleaseAssets: async function(releaseId) {
    var repoPath = '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO;
    return await this._request('GET', repoPath + '/releases/' + releaseId + '/assets');
  }
};
