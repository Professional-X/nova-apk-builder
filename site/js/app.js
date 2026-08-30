// =============================================================
// Main application logic
// =============================================================

let selectedFile = null;
let buildReleaseId = null;
let pollTimer = null;
let buildStartTime = 0;

// ---- Init ----
(function init() {
  if (OAuth.isLoggedIn()) {
    document.getElementById('btn-connect').textContent = '✓ GitHub Connected';
    document.getElementById('btn-connect').disabled = true;
    showBuildUI();
  }

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
    // Upload ZIP
    const { releaseId } = await GitHubAPI.uploadZip(selectedFile);
    buildReleaseId = releaseId;
    updateStep(0, '✓', 'ZIP uploaded', 'done');

    // Trigger workflow
    await GitHubAPI.triggerBuild(releaseId, signingMode);
    updateStep(1, '✓', 'Build triggered', 'done');
    addStep('⏳', 'Preparing build environment…', 'active');

    // Wait a moment for GitHub to register the run
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

    const status = run.status;          // queued, in_progress, completed
    const conclusion = run.conclusion;  // success, failure, cancelled, etc.

    // Update progress steps based on status
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
    // Network glitch — retry
    pollTimer = setTimeout(pollBuildStatus, CONFIG.POLL_INTERVAL_MS);
  }
}

function updateProgressFromRun(run) {
  // We infer progress from the workflow run status and any available jobs
  const steps = document.querySelectorAll('.progress-step');
  // steps[0] = ZIP uploaded, steps[1] = Build triggered (already done)
  // We add dynamic steps based on status

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

  // Find APK in release assets
  try {
    const assets = await GitHubAPI.getReleaseAssets(buildReleaseId);
    const apk = assets.find(a => a.name.endsWith('.apk'));
    const keystore = assets.find(a => a.name.endsWith('.jks') || a.name.endsWith('.keystore'));
    const properties = assets.find(a => a.name === 'keystore-properties.txt');

    let html = '<div class="result-success">';
    html += '<h2>🎉 APK Ready!</h2>';
    html += '<p>Build: <strong>' + escHtml(run.name || run.display_title || 'Build') + '</strong></p>';
    html += '<p>Status: <strong>Release</strong></p>';

    if (apk) {
      html += '<a class="download-btn" href="' + apk.browser_download_url + '" download>📱 Download ' + escHtml(apk.name) + '</a>';
    }

    // Signing key warning
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

    // Update release to non-draft
    await GitHubAPI.updateRelease(buildReleaseId, {
      draft: false,
      body: 'APK build succeeded.

' +
        (apk ? 'APK: ' + apk.name + '\n' : '') +
        (signingMode === 'generate' ? '\n⚠ Save the signing key assets for future updates.' : '')
    });

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

  // Reset build button
  const btn = document.getElementById('btn-build');
  btn.disabled = false;
  btn.textContent = '🔨 BUILD APK';
  selectedFile = null;
  document.getElementById('drop-zone').classList.remove('hidden');
  document.getElementById('file-info').classList.add('hidden');
  document.getElementById('file-input').value = '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
