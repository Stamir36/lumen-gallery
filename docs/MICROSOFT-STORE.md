# Publishing LUMEN to the Microsoft Store

The Store accepts an app in one of two shapes, and they are decided the moment
the product is reserved:

| | **MSIX package** (what LUMEN uses) | **Linked EXE/MSI installer** |
|---|---|---|
| Code signing | Microsoft signs it **for free** | you must buy a CA certificate |
| Hosting | **Microsoft hosts it** | you host it at a stable versioned HTTPS URL |
| WebView2 | the machine's Evergreen runtime | you must bundle ~210 MB, or be a downloader stub |
| What you upload | one `.msix` | a URL pointing at an `.exe` |

MSIX therefore costs nothing and has nothing to keep alive, which is why it is
the route below. The linked-installer route still exists and is documented in
§8 for the day a certificate is worth buying, but it is not the plan.

> **Sources:** [Using winapp CLI with Tauri](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri),
> [App package requirements for MSIX app](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements),
> [Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution).
> Microsoft moves Partner Center around regularly; if a button has moved, the
> Tauri page is the shorter read.

---

## 0. Prerequisites

| What | Why |
|---|---|
| Windows 10 2004 (10.0.19041) or later | the package targets `Windows.Desktop` from that build up |
| Windows SDK or Visual Studio with the UWP workload | `makeappx.exe` and `signtool.exe` build and sign the package |
| Node 20+, pnpm, Rust 1.77.2+ | to build the app |
| A **Microsoft account** + **Partner Center developer account** | the Store is run by Microsoft, so this is the login (a free individual account) |
| This repo at a tag you want to ship | e.g. `v0.2.0` |

No code-signing certificate is needed. `scripts/build-msix.ps1` creates a
throwaway self-signed one whose subject matches the manifest, which is enough
for Partner Center — Microsoft replaces it with its own signature on
certification.

---

## 1. Reserve the product — as a **Store app**, not as EXE/MSI

Partner Center → **Apps and games** → **New product** → **MSIX or PWA app**.
Reserve the name **LUMEN**.

> **The product type cannot be changed afterwards.** The earlier reservation in
> this project was created as *EXE or MSI app*, and that product can never accept
> an MSIX. Delete that reservation (or leave it unused, and reserve the name
> again — you may need a variant such as *LUMEN Gallery*) and start the MSIX
> product instead.

Then open **Product identity** and copy the three values — they go into the
manifest and nothing works until they match:

| Partner Center | Manifest |
|---|---|
| Package/Identity/Name | `Identity@Name` |
| Package/Identity/Publisher | `Identity@Publisher` |
| Package/Properties/PublisherDisplayName | `Properties/PublisherDisplayName` |

---

## 2. Build the MSIX

> Day-to-day detail — prerequisites, every flag, local install, the errors worth
> knowing — lives in [`docs/BUILD-MSIX.md`](BUILD-MSIX.md). This section is the
> short version.

The package carries **`lumen.exe` and nothing else**. The frontend is compiled
into the binary, and the WebView2 runtime is not bundled at all: a *packaged*
app runs against the machine's Evergreen WebView2 runtime, which every Windows 11
device has and the vast majority of Windows 10 devices have.

Edit `src-tauri/msix/Package.appxmanifest` once — the two identity values from
§1 — then:

```bash
pnpm build:msix          # or: powershell -File scripts/build-msix.ps1
```

The script:

1. builds the release binary (`pnpm tauri build --no-bundle`);
2. stages `lumen.exe`, the manifest and the icons from `src-tauri/icons/` into a
   clean folder — the icons are reused, not duplicated in the repo;
3. rewrites `Identity@Version` from `package.json` (`0.2.0` → `0.2.0.0`), so the
   version still has exactly one source of truth;
4. runs `makeappx pack` from the newest Windows SDK;
5. signs the result if you pass `-DevCert` or a `.pfx`.

The artifact lands at:

```
src-tauri/target/msix/LUMEN_<version>.0_x64.msix
```

It is about **6 MiB** — the whole 210 MB offline-WebView2 problem simply does not
exist on this route.

### What the manifest declares, and why

- `uap10:RuntimeBehavior="packagedClassicApp"` + `uap10:TrustLevel="mediumIL"`
  — a full-trust desktop app that gets package identity, no app container. Note
  that these are *attributes* of `<Application>`, not child elements: makeappx
  rejects the child-element form with a schema error.
- `<rescap:Capability Name="runFullTrust" />` — required by every packaged
  desktop app.
- `windows.fileTypeAssociation` for the eleven extensions in
  `src-tauri/src/assoc.rs`. **The package has to declare these**, because a
  packaged app's writes to `HKEY_CURRENT_USER` are copied into a private
  per-package hive that Explorer cannot see, so the runtime registration in
  `assoc.rs` cannot reach the real registry from inside the package. Declaring a
  handler only adds LUMEN to *Open with* — it never takes the default, which is
  exactly the contract `assoc.rs` was written to keep.
- Deliberately **no** `win32dependencies:ExternalDependency` for WebView2. It is
  documented, but AppX ignores the namespace
  (*"Declared namespace … is inapplicable, it will be ignored during manifest
  processing"*) and no such dependency package exists in the Store. Do not add
  it and assume the runtime arrives.

---

## 3. Try it locally before uploading

```powershell
# build and sign with a self-signed development certificate
powershell -ExecutionPolicy Bypass -File scripts/build-msix.ps1 -DevCert

# the certificate must be trusted before Windows will install the package
Import-Certificate -FilePath <the exported .cer> -CertStoreLocation Cert:\LocalMachine\TrustedPeople

Add-AppxPackage src-tauri\target\msix\LUMEN_0.2.0.0_x64.msix
```

Trusting a certificate in `LocalMachine` needs an administrator prompt. The
alternative is Developer Mode plus a loose-file registration
(`Add-AppxPackage -Register src-tauri\target\msix\stage\AppxManifest.xml`).

Check, in this order:

1. LUMEN appears in the Start menu with the right name and icon;
2. it launches and shows the library — **this is the check that matters**, since
   a packaged app runs against the machine's WebView2 runtime rather than one
   shipped inside the installer;
3. a right-click → *Open with* on a `.jpg` lists LUMEN;
4. a fresh library scans and indexes, and the thumbnails render;
5. uninstall from Settings removes the package and its per-package data.

`Remove-AppxPackage <PackageFullName>` cleans up afterwards.

---

## 4. What is different inside a package

Packaging is not a rebuild, but it is not a no-op either. The parts of LUMEN that
touch the outside world:

| Area | Inside an MSIX |
|---|---|
| App data (`%APPDATA%\com.unesell.lumen`) | writes are redirected to a per-package location under `%LOCALAPPDATA%\Packages\<family>\…`; a read falls back to the real path when the private copy does not exist yet, so a machine that already has an unpackaged library still finds it |
| Thumbnail cache | same redirection — works, just in a different folder |
| File associations | come from the manifest (see §2); the in-app opt-in toggle cannot write the real registry from inside the package |
| WebView2 | the machine's Evergreen runtime, never bundled |
| Local media server (`tiny_http` on loopback) | full-trust packages are not in an app container, so loopback stays available — but verify playback in the packaged build, this is the one place a packaging surprise would show up |
| File associations / registry cleanup | the generated `lumen-unregister.reg` is only meaningful for the unpackaged build; MSIX removes its own registrations on uninstall |

Anything that must go through a real registry key or a non-virtualized path would
need `unvirtualizedResources`, which is a **restricted capability** with its own
Partner Center approval. LUMEN avoids it on purpose: the manifest-declared
associations already cover the feature.

---

## 5. Fill in the submission

In Partner Center → your product → **Start submission**:

**Packages** — upload `LUMEN_<version>_x64.msix`. Architecture `x64`.

**Pricing and availability** — Free; market selection: *all markets*. Nothing in
LUMEN is region-dependent.

**Properties**

- Category: **Photos & video**.
- **Privacy policy URL** — required, and we already have one:
  `https://stamir36.github.io/lumen-gallery/privacy/`
- Support contact: `https://github.com/Stamir36/lumen-gallery/issues`
- Website: `https://stamir36.github.io/lumen-gallery/`
- System requirements: Windows 10 version 2004 or later, x64, 4 GB RAM.
- **This app accesses personal information** → *No*. LUMEN reads files at the
  user's request but never transmits them, and makes no outbound connections.

**Age rating** — no user-generated content, no online interaction, no ads; expect
a 3+/E rating. Answer honestly: a video player can open any file the user has,
and the questionnaire asks about exactly that.

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

**Screenshots** — PNG, at least 1366×768, up to 10:

```powershell
# the repo screenshots are 2564×1604 JPEGs — convert to PNG for the listing
python -c "from PIL import Image; [Image.open(f'assets/Screen{i}.jpg').save(f'store-screen{i}.png') for i in range(1,5)]"
```

Use Screen1 (library) as the hero image, then the video player, the photo viewer
and personalization. Add the wizard screenshot last if you want it.

---

## 6. Certification

Then **Submit for certification**. Typical turn-around for a new product is 1–3
business days. What gets MSIX submissions rejected:

- a package **signature that does not match** the identity publisher;
- a package **version that does not increase** across submissions;
- the app crashing on launch, or showing UI only after a separate download;
- requesting a **restricted capability** without a justification;
- the submitted version not matching the version shown in the app.

Everything on that list is checked before uploading: `pnpm build:msix` fails on a
schema error, and §3 covers launch, associations and uninstall.

The package review page turns those into rows. Read it as a gate, not a score: ✓
is a pass, and «Не удалось определить» is a row the reviewer could not establish.

---

## 7. Shipping a new version later

```bash
# 1. bump the version in all three places
#    package.json · src-tauri/Cargo.toml · src-tauri/tauri.conf.json
# 2. move the CHANGELOG "Unreleased" section down
# 3. commit, tag v<version>, push the tag — the Release workflow builds the
#    .msix, signs it and attaches it to the draft release
# 4. publish that draft release
# 5. Partner Center → your product → Update → upload the new .msix, submit
```

The package version comes from `package.json` (§2), and the Store requires it to
be strictly higher than the published one — a resubmission of the same version is
rejected before it is even reviewed.

The Store version and the GitHub release version do not have to be identical, but
keeping them equal keeps the bug reports coherent: LUMEN shows its version in the
title bar and in Settings → About.

---

## 8. Fallback: the linked EXE installer

Only worth doing with a certificate, and there is no way around that. Microsoft
requires a linked installer to be signed with a certificate chaining to a CA in
the Microsoft Trusted Root Program, and self-signed is explicitly not acceptable.
Azure Artifact Signing (~$10/month) is limited to organizations in the US, Canada,
the EU and the UK and to **individuals in the US or Canada**; everyone else needs
an OV certificate from DigiCert, Sectigo and friends, typically $150–300/year.

The four rules for a linked product, from [App package requirements for MSI/EXE
app](https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements):

1. the download URL is HTTPS, **versioned**, and the binary behind it never
   changes after the submission;
2. the installer **and every PE file inside it** are signed;
3. starting the install shows **no user interface** (a UAC prompt is allowed);
4. it is a **standalone installer, not a downloader stub** — setup may not
   download anything while it runs.

> **Why the first attempt at this was blocked.** The installer behind the linked
> URL came from plain `pnpm tauri build`, whose default WebView2 mode
> (`downloadBootstrapper`) fetches the runtime over the network during setup.
> That breaks rule 4, so Microsoft's validation could never finish an unattended
> install — the three checks that depend on one (*Проверка автоматической
> установки*, *Запись в списке «Установка и удаление программ»*, *Проверка
> пакетного ПО*) all came back «Не удалось определить», and `Отправить` refused
> the invalid package set with *«модули PackageSet недействительны»*.

`src-tauri/tauri.microsoftstore.conf.json` and `build-store.bat` build the
compliant variant: offline WebView2 (rule 4), no installer UI (rule 3, `/S`), and
Tauri's `signCommand` wired to `scripts/sign-file.ps1`, which signs the app
binary, every NSIS plugin and the installer in one pass (rule 2):

```powershell
$env:LUMEN_SIGN_PFX      = 'C:\path\to\code-signing.pfx'
$env:LUMEN_SIGN_PASSWORD = '<password>'
pnpm build:store     # or double-click build-store.bat
```

That installer is **~210 MiB**, because the offline WebView2 runtime is 213 MB on
its own and does not compress. It cannot be committed (GitHub refuses any file
over 100 MiB) and it cannot live on a GitHub **release** either — release URLs
302-redirect to `objects.githubusercontent.com` and Partner Center rejects them
outright (*«Provided URL redirects to another URL»*). It needs a host that answers
directly: GitHub Pages with the file injected at deploy time, or a CDN.

In Partner Center that route asks for the URL, architecture `x64`, installer
parameter `/S`, type `EXE`, and a table of exit codes. The form is written for
MSI, so it asks in Windows Installer codes; the only row that describes this
installer is *installation completed* = `0`. If it insists on the rest, the usual
values are `1602` (cancelled by the user), `1618` (another install running),
`112` (disk full), `3010` (reboot required), `1603` (rejected by policy), and
*Сбой сети* stays empty because a correct build never touches the network.

---

## 9. Optional: automating the upload

Microsoft ships **Microsoft Store Developer CLI** (`msstore`) and there is a
`winapp` CLI with a `winapp store` command; both can drive submissions from a
build agent with a tenant id, seller id, client id and client secret from a
Partner Center Azure AD app. Worth wiring up only once manual uploads get
tedious:

```powershell
winget install Microsoft.StoreDeveloperCLI
msstore reconfigure --tenantId $TENANT --sellerId $SELLER --clientId $CLIENT --clientSecret $SECRET
msstore publish -p src-tauri/target/msix/LUMEN_0.2.0.0_x64.msix
```

Keep the client secret in GitHub Actions secrets, and remember that the Store
wants the **package**, not the unpackaged binary.

---

## See also

- `src-tauri/msix/Package.appxmanifest` — the package identity, capabilities and
  declared file associations
- `scripts/build-msix.ps1` — stage, version, pack, sign
- `.github/workflows/release.yml` — builds the MSIX on a tag and attaches it to
  the draft release
- `docs/WEBSITE.md` — the landing page, including the privacy policy URL you
  must paste into Partner Center
- `CHANGELOG.md` — where each version's user-visible changes are recorded
