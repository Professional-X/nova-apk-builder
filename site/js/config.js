// =============================================================
// Nova APK Builder — Configuration
// =============================================================
// ONE-TIME SETUP REQUIRED:
//   1. Go to https://github.com/settings/developers
//   2. Click “New OAuth App”
//   3. Application name:  Nova APK Builder
//   4. Homepage URL:     https://professional-x.github.io/nova-apk-builder/
//   5. Callback URL:     https://professional-x.github.io/nova-apk-builder/
//   6. Click “Register application”
//   7. Copy the “Client ID” shown at the top
//   8. Replace the empty string below with that Client ID
// =============================================================

const CONFIG = {
  GITHUB_OWNER: 'Professional-X',
  GITHUB_REPO:  'nova-apk-builder',
  OAUTH_CLIENT_ID: '',   // <-- Paste your OAuth App Client ID here
  API_BASE: 'https://api.github.com',
  MAX_ZIP_MB: 100,
  POLL_INTERVAL_MS: 8000,
  BUILD_TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes
};