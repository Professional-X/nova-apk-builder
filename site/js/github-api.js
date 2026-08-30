// =============================================================
// GitHub API helpers — all calls use the OAuth token from sessionStorage
// =============================================================

const GitHubAPI = {

  // ---- helpers ----
  _headers() {
    return {
      'Authorization': 'Bearer ' + OAuth.getToken(),
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  },

  async _request(method, path, body) {
    const url = CONFIG.API_BASE + path;
    const opts = { method, headers: this._headers() };
    if (body && method !== 'GET') {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!resp.ok) {
      const msg = (data && data.message) || resp.statusText;
      throw new Error(msg);
    }
    return data;
  },

  // ---- upload ZIP as release asset ----
  async uploadZip(file) {
    // Create a draft release
    const tag = 'build-' + Date.now();
    const release = await this._request('POST',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/releases',
      { tag_name: tag, name: tag, draft: true, body: 'APK build request' }
    );

    // Upload ZIP as release asset
    const uploadUrl = release.upload_url
      .replace('{?name,label}', '?name=source.zip');

    const resp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OAuth.getToken(),
        'Content-Type': 'application/zip'
      },
      body: file
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Upload failed: ' + err);
    }

    return { releaseId: release.id, tag, uploadUrl: release.html_url };
  },

  // ---- trigger build workflow ----
  async triggerBuild(releaseId, signingMode) {
    return this._request('POST',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/actions/workflows/build-apk.yml/dispatches',
      { ref: 'main', inputs: { release_id: String(releaseId), signing_mode: signingMode } }
    );
  },

  // ---- poll for latest workflow run ----
  async getLatestRun() {
    const data = await this._request('GET',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/actions/workflows/build-apk.yml/runs?per_page=1'
    );
    return data.workflow_runs && data.workflow_runs[0] ? data.workflow_runs[0] : null;
  },

  // ---- get run status ----
  async getRunStatus(runId) {
    return this._request('GET',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/actions/runs/' + runId
    );
  },

  // ---- get run logs ----
  async getRunLogs(runId) {
    try {
      const resp = await fetch(
        CONFIG.API_BASE + '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/actions/runs/' + runId + '/logs',
        { headers: { 'Authorization': 'Bearer ' + OAuth.getToken() } }
      );
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return blob;
    } catch { return null; }
  },

  // ---- get release assets (to find APK) ----
  async getReleaseAssets(releaseId) {
    const data = await this._request('GET',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/releases/' + releaseId + '/assets'
    );
    return data;
  },

  // ---- update release (mark non-draft, add body) ----
  async updateRelease(releaseId, body) {
    return this._request('PATCH',
      '/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/releases/' + releaseId,
      body
    );
  }
};