# Publishing LUMEN to the Microsoft Store

LUMEN ships as a **Win32 desktop app** (Tauri + NSIS installer), which is the
"EXE or MSI app" product type in Partner Center. There is no MSIX packaging step
and no sandbox: the Store installs the signed installer like a normal
downloader would, so the tray, the file associations and the `%APPDATA%`
database keep working exactly as they do in a GitHub release.

Everything below is a one-time setup, except the last section, which is what you
repeat for every version.

> **Sources:** [Tauri — Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/)
> and [Publish your app on the Microsoft Store](https://learn.microsoft.com/windows/apps/publish/).
> Microsoft changes Partner Center regularly; if a button has moved, the Tauri
> page is the shorter read.

---

## 0. Prerequisites

| What | Why |
|---|---|
| Windows 10/11 with the Windows SDK | signing tools (`signtool`) and, optionally, `makeappx` |
| Node 20+, pnpm, Rust 1.77.2+ | to build the app |
| A **Microsoft account** | the Store is run by Microsoft, so this is the login |
| **Partner Center developer account** | individual is a one-time fee (historically $19); company is higher and needs verification |
| A **code-signing certificate** | Store submissions of Win32 products must be signed — see §3 |
| This repo at a tag you want to ship | e.g. `v0.2.0` |

Register at <https://partner.microsoft.com/dashboard>. As an individual, keep
your **publisher display name** exactly as Partner Center shows it — you will
need to type it into the config in §2.

---

## 1. Reserve the product in Partner Center

1. Partner Center → **Apps and games** → **New product** → **EXE or MSI app**.
2. Reserve the name **LUMEN**. If it is taken, the Store will suggest variants;
   the product name is what appears in search, and it is the one thing that
   cannot be changed later without a new product.
3. Note the **product identity** shown afterwards (Store ID, package/identity
   values). For an EXE/MSI product there is no `Package/Identity/Name` involved —
   that block only applies to MSIX submissions.

---

## 2. Build the Store installer

The only difference from a normal release build is that the Store requires an
**offline WebView2 installer** (the app may be installed on a machine without
internet) and a **silent** install. Both are prepared in
`src-tauri/tauri.microsoftstore.conf.json`, which is merged on top of
`tauri.conf.json` only for this build:

```jsonc
{
  "bundle": {
    "publisher": "Stanislav Miroshnichenko",   // ← must equal your Partner Center publisher display name
    "windows": {
      "webviewInstallMode": { "type": "offlineInstaller" },
      "nsis": { "displayLanguageSelector": false, "languages": ["English", "Russian"] }
    }
  }
}
```

**Edit the publisher string first.** Partner Center rejects a product whose
publisher does not match your account, and the error message does not say why.

Build:

```bash
pnpm build:store
# = tauri build --no-bundle
#   tauri bundle --config src-tauri/tauri.microsoftstore.conf.json
```

The artifact appears at:

```
src-tauri/target/release/bundle/nsis/LUMEN_0.2.0_x64-setup.exe
```

It is noticeably larger than the GitHub-release installer (≈ 130 MB): the
offline WebView2 runtime is bundled inside it.

Before uploading, verify the two Store requirements by hand:

```powershell
# 1. silent install — must return to the prompt with no window
.\LUMEN_0.2.0_x64-setup.exe /S
# 2. it actually installed, per user
& "$env:LOCALAPPDATA\LUMEN\LUMEN.exe"
```

> The silent flag for Tauri's NSIS installer is `/S` with a **capital S**. That
> is the value you paste into Partner Center in §4.

---

## 3. Sign it

Microsoft requires the linked installer to be code signed. For an individual
developer the cheapest workable options are:

| Option | Notes |
|---|---|
| **Azure Trusted Signing** | subscription-based (roughly $10/month), issues short-lived certs, integrates with `signtool` and CI, and avoids the EV hardware-token dance. Currently the most practical route for a solo developer. |
| **EV code-signing certificate** | the classic choice; you receive a hardware token or cloud HSM. More expensive, but immediately trusted by SmartScreen. |
| **OV certificate** | cheaper, but SmartScreen reputation still has to build up over downloads. |

Sign the installer (not just the exe inside it):

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 `
  /f mycert.pfx /p $env:CERT_PASSWORD `
  src-tauri\target\release\bundle\nsis\LUMEN_0.2.0_x64-setup.exe

signtool verify /pa src-tauri\target\release\bundle\nsis\LUMEN_0.2.0_x64-setup.exe
```

Tauri's bundler can also sign during the build; see
`bundle.windows.certificateThumbprint` / `signCommand` in the Tauri config
reference if you would rather do it in one step.

---

## 4. Fill in the submission

In Partner Center → your product → **Start submission**:

**Packages**

- Upload `LUMEN_<version>_x64-setup.exe`.
- **Silent install parameters**: `/S`
- Architecture: `x64`.
- If you also ship an ARM64 build, add it as a second package in the same
  submission.

**Pricing and availability**

- Free; market selection: *all markets* (or at least all where you want to be
  found). Nothing in LUMEN is region-dependent.

**Properties**

- Category: **Photos & video** (secondary: *Utilities & tools*, *Multimedia
  design* — pick one; the Store allows a single primary category).
- **Privacy policy URL** — required, and we already have one:
  `https://stamir36.github.io/lumen-gallery/privacy/`
- Support contact: your GitHub issues URL,
  `https://github.com/Stamir36/lumen-gallery/issues`.
- Website: `https://stamir36.github.io/lumen-gallery/`
- System requirements: Windows 10 version 1809 or later, x64, 4 GB RAM.
- **This app accesses personal information** → *Yes* is wrong; LUMEN reads
  files at the user's request but never transmits them. Answer the capability
  questions about network *No* — LUMEN makes no outbound connections of its own,
  which is exactly what the Store's capability audit is looking for.

**Age rating**

- Questionnaire: no user-generated content, no online interaction, no ads. The
  result will be a low (3+/E) rating. Answer honestly: a video player can open
  any file the user has, and the questionnaire asks about exactly that.

**Store listing** — ready-to-paste copy:

> **Short description (max 100 chars)**
> `Fast, private, local-first photo & video gallery for Windows. No cloud, no import, no account.`
>
> **Description**
> `LUMEN turns the folders you already have into a fast gallery, photo viewer and video player. It indexes in the background, renders its own thumbnails and never moves, uploads or rewrites a single byte of your media.`
> `• Instant scrolling through tens of thousands of files — virtualized grid with four layouts`
> `• Native thumbnails, cached, so the library opens immediately`
> `• Real video player: resume positions, hover scrubbing, color correction, mini-player window`
> `• Search, sort and filters; smart views for photos, videos, favorites, recents and trash`
> `• Ten accent colors, density presets, corner styles and animation switches`
> `• No telemetry, no network calls, no account. Works entirely offline.`
> `Open source under GPL-3.0 — the full source is on GitHub.`

**Screenshots** — the Store wants PNG (JPEG is accepted for some fields but PNG
is safest), at least 1366×768, and up to 10 images:

```powershell
# the repo screenshots are 2564×1604 JPEGs — convert to PNG for the listing
python -c "from PIL import Image; [Image.open(f'assets/Screen{i}.jpg').save(f'store-screen{i}.png') for i in range(1,5)]"
```

Use Screen1 (library) as the hero image, then the video player, the photo
viewer and personalization. Add the wizard screenshot last if you want it.

---

## 5. Certification

Then **Submit for certification**. Typical turn-around for a new product is
1–3 business days. Things that get Win32 submissions rejected, all of which
we check before uploading:

- **10.2.9.2** — the installer must run silently: `LUMEN_*_setup.exe /S` ✓
- the installer must be **signed** ✓
- the app must launch and show UI without crashing ✓
- it must not require a separate download to run (offline WebView2 ✓)
- the submitted version must match the version in the app ✓

If a submission comes back rejected, the report names the failed policy number
and the exact test; fix, rebuild with a **higher version number**, and start a
new submission — you cannot resubmit an identical package.

---

## 6. Shipping a new version later

```bash
# 1. bump the version in all three places
#    package.json · src-tauri/Cargo.toml · src-tauri/tauri.conf.json
# 2. move the CHANGELOG "Unreleased" section down
# 3. rebuild and sign
pnpm build:store
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f mycert.pfx /p $env:CERT_PASSWORD src-tauri/target/release/bundle/nsis/LUMEN_*_x64-setup.exe
# 4. Partner Center → your product → Update → upload the new exe, /S, submit
```

Note that the Store version and the GitHub release version do not have to be
identical, but keeping them equal keeps the bug reports coherent: LUMEN shows
its version in the title bar and in Settings → About.

---

## 7. Optional: automating the upload

Microsoft ships a CLI, **Microsoft Store Developer CLI** (`msstore`), which can
drive submissions from a build agent with a tenant id, seller id, client id and
client secret from a Partner Center Azure AD app. It is worth wiring up only
once manual submissions get tedious:

```powershell
winget install Microsoft.StoreDeveloperCLI
msstore reconfigure --tenantId $TENANT --sellerId $SELLER --clientId $CLIENT --clientSecret $SECRET
msstore publish -p src-tauri/target/release/bundle/nsis/LUMEN_0.2.0_x64-setup.exe -a /S
```

Keep the client secret in GitHub Actions secrets, and remember that the Store
also wants the **installer**, not just the exe.

---

## 8. The MSIX alternative (probably not worth it)

Microsoft documents packaging a Tauri app as MSIX with the `winapp` CLI
(<https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri>).
MSIX gives you package identity (useful for toast notifications) but it is a
real project of its own: repackaged install location, different data paths, and
file associations that only work while the package is registered. LUMEN already
ships an NSIS per-user installer that satisfies the Store, so treat MSIX as a
future experiment, not the shipping plan.

---

## See also

- `.github/workflows/release.yml` — the tag-driven GitHub release: pushing
  `v*` builds the installer and opens a draft release with it attached (that is
  the installer you also hand to the Store)
- `docs/WEBSITE.md` — the landing page, including the privacy policy URL you
  must paste into Partner Center
- `CHANGELOG.md` — where each version's user-visible changes are recorded
