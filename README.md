# 🚀 Nova APK Builder

Build a **signed release APK** from an Android or Flutter source-code ZIP — directly in your browser.
No Android SDK, no Gradle, no Flutter installation needed on your computer.

---

## How It Works

```
You open the website
     ↓
Connect GitHub (one-time, 30 seconds)
     ↓
Upload your source .zip file
     ↓
Click  BUILD APK
     ↓
GitHub Actions builds your APK in the cloud
     ↓
Download the signed APK
```

### Architecture

| Component | What it does |
|-----------|-------------|
| **Website** (GitHub Pages) | The UI you see in your browser. Static HTML/CSS/JS. |
| **GitHub OAuth** | Lets the website talk to GitHub on your behalf — without exposing any password or token. |
| **GitHub Release** | Stores your uploaded ZIP temporarily and the finished APK. |
| **GitHub Actions** | A cloud computer that downloads your ZIP, detects the project type, builds the APK, signs it, and uploads it back. |

---

## Live Website

👉 **https://professional-x.github.io/nova-apk-builder/**

---

## ONE-TIME SETUP REQUIRED

Before the website can build APKs, you need to do two things. Both take about 2 minutes total.

### Step 1: Enable GitHub Pages

1. Go to **https://github.com/Professional-X/nova-apk-builder/settings/pages**
2. Under **Source**, select **GitHub Actions**
3. Click **Save**

> Why? This tells GitHub to serve the website from this repository.

### Step 2: Register an OAuth App

1. Go to **https://github.com/settings/developers**
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** `Nova APK Builder`
   - **Homepage URL:** `https://professional-x.github.io/nova-apk-builder/`
   - **Authorization callback URL:** `https://professional-x.github.io/nova-apk-builder/`
4. Click **Register application**
5. Copy the **Client ID** shown at the top of the page
6. Tell me the Client ID — I will update `site/js/config.js` with it for you.

> Why? The website uses GitHub's Device Flow so your personal access token is **never** in the browser. Only the public Client ID is needed.

### Step 3 (Optional): Use Your Own Signing Key

If you want to use your own keystore for signing (instead of generating a new one each time):

1. Base64-encode your `.jks` or `.keystore` file:
   ```bash
   base64 -i my-keystore.jks | pbcopy
   ```
2. Go to **https://github.com/Professional-X/nova-apk-builder/settings/secrets/actions**
3. Add these secrets:
   | Secret Name | Value |
   |-------------|-------|
   | `SIGNING_KEYSTORE_BASE64` | (paste the base64-encoded keystore) |
   | `KEYSTORE_PASSWORD` | Your keystore password |
   | `KEY_PASSWORD` | Your key password |
   | `KEY_ALIAS` | Your key alias |

---

## How to Use

1. **Open** the website: https://professional-x.github.io/nova-apk-builder/
2. **Connect GitHub** — a code appears; open the link, enter the code, authorize.
3. **Select your .zip** — drag and drop or tap to browse.
4. **Choose signing** — "Generate new key" (recommended for first build) or "Use existing key".
5. **Click BUILD APK** — wait 3–10 minutes.
6. **Download the APK** and the signing key files.

### About Signing Keys

- **If you generated a new key:** Download the `.jks` and `keystore-properties.txt` files from the release. **Save them somewhere safe.** You need the exact same key to publish future updates to your app. If you lose it, users will have to uninstall the old version before installing the update.
- **If you used an existing key:** The APK is signed with the key from your GitHub Secrets.

---

## Current Limitations

- **Single-recipe builds only** — each ZIP produces one APK.
- **No AAB/App Bundle support** — only APK output.
- **Personal use** — designed for one person's GitHub account. Making it publicly available to strangers would require a different architecture (user accounts, rate limiting, cost management) to prevent abuse.
- **30-minute timeout** — very large projects may time out.
- **No custom build variants** — builds the default release variant.

---

## Security Notes

- Your source code is uploaded to a **draft GitHub Release** in your own repository. It is not sent to any third party.
- The build runs on **ephemeral GitHub-hosted runners** — nothing is persisted after the build.
- The workflow uses **least-privilege permissions** (`contents: write`, `actions: read`).
- **ZIP validation** prevents path traversal and zip bombs.
- **OAuth token** is scoped to `public_repo` and `repo:status` only, stored in browser `sessionStorage` (cleared when you close the tab).
- **Signing keys** are never logged or exposed. Generated keys are downloadable only from the release.

### Important User Actions

- ⚠️ **Revoke** any personal access tokens you shared publicly (including the one used during setup).
- ⚠️ **Save your signing key** if you chose "Generate new key" — it cannot be recovered.
- ⚠️ **Do not** make this repository public if you have signing keys stored as GitHub Secrets.

---

## Project Structure

```
nova-apk-builder/
├── .github/workflows/
│   ├── build-apk.yml      ← Cloud build pipeline
│   └── deploy-pages.yml   ← Website deployment
├── site/
│   ├── index.html         ← Main page
│   ├── css/style.css      ← Dark theme styling
│   └── js/
│       ├── config.js      ← OAuth Client ID goes here
│       ├── oauth.js       ← GitHub Device Flow
│       ├── github-api.js  ← GitHub API helpers
│       └── app.js         ← Main application logic
├── tests/
│   ├── test-android/      ← Minimal Android test project
│   └── test-flutter/      ← Minimal Flutter test project
└── README.md
```
