// =============================================================
// Main application logic
// =============================================================

let selectedFile = null;
let buildReleaseId = null;
let pollTimer = null;
let buildStartTime = 0;

// ---- Auth helpers ----
function getToken() {
  return sessionStorage.getItem('gh_token');
}

function isLoggedIn() {
  return !!getToken();
}

function toggleTokenVisibility() {
  const inp = document.getElementById('token-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function connectWithToken() {
  const tokenInput = document.getElementById('token-input');
  const statusEl = document.getElementById('auth-status');
  const btn = document.getElementById('btn-connect');
  const token = tokenInput.value.trim();

  if (!token) {
    statusEl.innerHTML = '<span style="color:#f85149">Please paste your GitHub token above.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying…';
  statusEl.innerHTML = '';

  try {
    // Verify token by fetching user info
    const resp = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Token invalid or expired (HTTP ' + resp.status + ')');
    }
    const user = await resp.json();

    // Check if the user has access to the target repo
    const repoResp = await fetch('https://api.github.com/repos/' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '/actions/workflows', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!repoResp.ok) {
      throw new Error('Token works but lacks access to ' + CONFIG.GITHUB_OWNER + '/' + CONFIG.GITHUB_REPO + '. Make sure your token has the <strong>repo</strong> scope and you have access to the repository.');
    }

    // Save token
    sessionStorage.setItem('gh_token', token);
    statusEl.innerHTML = '<span style="color:#3fb950">✓ Connected as ' + escHtml(user.login) + '</span>';
    btn.textContent = '✓ Connected';
    tokenInput.value = '';

    setTimeout(() => showBuildUI(), 500);

  } catch (err) {
    statusEl.innerHTML = '<span style="color:#f85149">' + err.message + '</span>';
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function logout() {
  sessionStorage.removeItem('gh_token');
  location.reload();
}

// ---- Init ----
(function init() {
  if (isLoggedIn()) {
    document.getElementById('btn-connect').textContent = '✓ Connected';
    document.getElementById('btn-connect').disabled = true;
    document.getElementById('token-input').style.display = 'none';
    document.querySelector('.token-input-wrap').style.display = 'none';
    showBuildUI();
  }

  // Allow Enter key to connect
  document.getElementById('token-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') connectWithToken();
  });

  // Drag-and-drop
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('click', () => document.getElementById('file-input').click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
})();

// ---- Show build UI after auth ----
function showBuildUI() {
  document.getElementById('step-auth').classList.add('hidden');
  document.getElementById('step-upload').classList.remove('hidden');
  document.getElementById('step-signing').classList.remove('hidden');
  document.getElementById('step-build').classList.remove('hidden');
}

// ---- File handling ----
function handleFileSelect(event) {
  if (event.target.files.length) handleFile(event.target.files[0]);
}

function handleFile(file) {
  if (!file.name.endsWith('.zip')) {
    alert('Please select a .zip file.');
    return;
  }
  const maxBytes = CONFIG.MAX_ZIP_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    alert('File is too large. Maximum size is ' + CONFIG.MAX_ZIP_MB + ' MB.');
    return;
  }
  selectedFile = file;
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-size').textContent = formatBytes(file.size);
  document.getElementById('file-info').classList.remove('hidden');
  document.getElementById('drop-zone').classList.add('hidden');
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ---- Start build ----
async function startBuild() {
  if (!selectedFile) { alert('Please select a ZIP file first.'); return; }

  const signingMode = document.querySelector('input[name="signing"]:checked').value;
  const btnBuild = document.getElementById('btn-build');
  btnBuild.disabled = true;
  btnBuild.textContent = 'Uploading…';

  showSection('step-progress');
  setProgressTitle('🔨 Uploading ZIP…');
  addStep('✓', 'ZIP uploaded', 'pending');
  addStep('⏳', 'Triggering build…', 'active');

  try {
    const { releaseId } = await GitHubAPI.uploadZip(selectedFile);
    buildReleaseId = releaseId;
    updateStep(0, '✓', 'ZIP uploaded', 'done');

    await GitHubAPI.triggerBuild(releaseId, signingMode);
    updateStep(1, '✓', 'Build triggered', 'done');
    addStep('⏳', 'Preparing build environment…', 'active');

    await sleep(3000);
    buildStartTime = Date.now();
    pollBuildStatus();

  } catch (err) {
    showResult('error', 'Upload / trigger failed', err.message);
  }
}

// ---- Poll build ----
async function pollBuildStatus() {
  const elapsed = Date.now() - buildStartTime;
  if (elapsed > CONFIG.BUILD_TIMEOUT_MS) {
    showResult('error', 'Build timed out',
      'The build took longer than 30 minutes. Check GitHub Actions for details.');
    return;
  }

  try {
    const run = await GitHubAPI.getLatestRun();
    if (!run) {
      pollTimer = setTimeout(pollBuildStatus, CONFIG.POLL_INTERVAL_MS);
      return;
    }

    const status = run.status;
    const conclusion = run.conclusion;

    updateProgressFromRun(run);

    if (status === 'completed') {
      if (conclusion === 'success') {
        await onBuildSuccess(run);
      } else {
        await onBuildFailure(run);
      }
      return;
    }

    pollTimer = setTimeout(pollBuildStatus, CONFIG.POLL_INTERVAL_MS);
  } catch (err) {
    pollTimer = setTimeout(pollBuildStatus, CONFIG.POLL_INTERVAL_MS);
  }
}

function updateProgressFromRun(run) {
  const status = run.status;

  if (status === 'queued') {
    setProgressTitle('🔨 Queued…');
    ensureStep(2, '⏳', 'Waiting for runner…', 'active');
  } else if (status === 'in_progress') {
    setProgressTitle('🔨 Building APK…');
    ensureStep(2, '✓', 'Build environment ready', 'done');
    ensureStep(3, '⏳', 'Compiling APK…', 'active');
  }
}

function ensureStep(index, icon, text, cls) {
  const steps = document.querySelectorAll('.progress-step');
  if (steps[index]) {
    steps[index].className = 'progress-step ' + cls;
    steps[index].innerHTML = '<span class="icon">' + icon + '</span><span>' + text + '</span>';
  } else {
    addStep(icon, text, cls);
  }
}

// ---- Build success ----
async function onBuildSuccess(run) {
  setProgressTitle('🎉 APK Ready!');
  ensureStep(2, '✓', 'Build environment ready', 'done');
  ensureStep(3, '✓', 'APK compiled', 'done');
  ensureStep(4, '✓', 'APK signed', 'done');
  ensureStep(5, '✓', 'APK uploaded', 'done');

  try {
    const assets = await GitHubAPI.getReleaseAssets(buildReleaseId);
    const apk = assets.find(a => a.name.endsWith('.apk'));
    const keystore = assets.find(a => a.name.endsWith('.jks') || a.name.endsWith('.keystore'));
    const properties = assets.find(a => a.name === 'keystore-properties.txt');

    let html = '<div class="result-success">';
    html += '<h2>🎉 APK Ready!</h2>';
    html += '<p>Build: <strong>' + escHtml(run.name || run.display_title || 'Build') + '</strong></p>';
    html += '<p>Signing: <strong>Release</strong></p>';

    if (apk) {
      html += '<a class="download-btn" href="' + apk.browser_download_url + '" download>📱 Download ' + escHtml(apk.name) + '</a>';
    }

    const signingMode = document.querySelector('input[name="signing"]:checked')?.value || 'generate';
    if (signingMode === 'generate') {
      html += '<div class="warning-box">';
      html += '⚠ <strong>Save your signing key!</strong><br>';
      html += 'You need the same key for future app updates. ';
      html += 'If you lose it, users won\'t be able to install updates.';
      html += '</div>';
      if (keystore) {
        html += '<div class="key-download">';
        html += '🔐 <a href="' + keystore.browser_download_url + '" download>Download Keystore</a>';
        html += '</div>';
      }
      if (properties) {
        html += '<div class="key-download">';
        html += '📋 <a href="' + properties.browser_download_url + '" download>Download Key Properties</a>';
        html += '</div>';
      }
    }

    html += '</div>';
    showResultHTML(html);

  } catch (err) {
    showResult('error', 'APK Ready but download failed', err.message);
  }
}

// ---- Build failure ----
async function onBuildFailure(run) {
  setProgressTitle('❌ Build Failed');
  ensureStep(2, '✗', 'Build failed', 'error');

  let html = '<div class="result-error">';
  html += '<h2>❌ Build Failed</h2>';
  html += '<p>The project could not be compiled.</p>';
  html += '<a class="download-btn" href="' + run.html_url + '" target="_blank" rel="noopener">View Details on GitHub</a>';
  html += '</div>';
  showResultHTML(html);
}

// ---- UI helpers ----
function showSection(id) {
  ['step-progress', 'step-result'].forEach(s =>
    document.getElementById(s).classList.add('hidden')
  );
  document.getElementById(id).classList.remove('hidden');
}

function setProgressTitle(t) {
  document.getElementById('progress-title').textContent = t;
}

function addStep(icon, text, cls) {
  const div = document.createElement('div');
  div.className = 'progress-step ' + (cls || '');
  div.innerHTML = '<span class="icon">' + icon + '</span><span>' + text + '</span>';
  document.getElementById('progress-steps').appendChild(div);
}

function updateStep(index, icon, text, cls) {
  const steps = document.querySelectorAll('.progress-step');
  if (steps[index]) {
    steps[index].className = 'progress-step ' + cls;
    steps[index].innerHTML = '<span class="icon">' + icon + '</span><span>' + text + '</span>';
  }
}

function showResult(type, title, message) {
  const cls = type === 'error' ? 'result-error' : 'result-success';
  const icon = type === 'error' ? '❌' : '🎉';
  showResultHTML(
    '<div class="' + cls + '">' +
    '<h2>' + icon + ' ' + escHtml(title) + '</h2>' +
    '<p>' + escHtml(message) + '</p>' +
    '</div>'
  );
}

function showResultHTML(html) {
  document.getElementById('step-progress').classList.add('hidden');
  const rc = document.getElementById('result-content');
  rc.innerHTML = html;
  document.getElementById('step-result').classList.remove('hidden');

  const btn = document.getElementById('btn-build');
  btn.disabled = false;
  btn.textContent = '🔨 BUILD APK';
  selectedFile = null;
  document.getElementById('drop-zone').classList.remove('hidden');
  document.getElementById('file-info').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
