# Building the MSIX

Everything needed to produce the Microsoft Store package by hand, at any time,
with nothing but this repository and a Windows machine. For *why* MSIX and what
happens after the build, see `docs/MICROSOFT-STORE.md`.

```bash
pnpm build:msix
# → src-tauri/target/msix/LUMEN_0.2.0.0_x64.msix   (~6 MiB)
```

That one line is the whole thing. The rest of this page is what it does, what can
go wrong, and how to check the result.

---

## 1. What has to be on the machine

| Requirement | Check with | If it is missing |
|---|---|---|
| **Windows 10 2004+** (10.0.19041) | `winver` | the package targets `Windows.Desktop` from that build up |
| **Windows SDK** — provides `makeappx.exe` | `& "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe"` | install *Windows SDK for Windows 10* or Visual Studio with the **UWP** workload |
| **signtool.exe** — same SDK | same folder, `signtool.exe` | comes with the SDK above |
| **Node 20+, pnpm** | `node -v` · `pnpm -v` | `npm i -g pnpm` |
| **Rust 1.77.2+** | `rustc -V` | <https://rustup.rs> |
| **WebView2 runtime** | `Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'` | preinstalled on Windows 11; on Windows 10 install the Evergreen runtime |

The script finds the SDK itself: it looks on `PATH` first, then takes the
**newest** `Windows Kits\10\bin\<version>\x64`. Nothing has to be added to `PATH`,
and no environment variable has to be set for a plain build.

No code-signing certificate is required. See §5.

---

## 2. The one-time identity edit

`src-tauri/msix/Package.appxmanifest` ships with placeholders, and Partner Center
compares the two values below **character by character**. Paste them from
Partner Center → your product → **Product identity**:

```xml
<Identity
  Name="Stamir36.LUMENGallery"                      <!-- Package/Identity/Name -->
  Publisher="CN=EDIT-ME-PARTNER-CENTER-PUBLISHER"   <!-- Package/Identity/Publisher -->
  Version="0.2.0.0"
  ProcessorArchitecture="x64" />
```

You will know it is still unedited: the build prints

```
WARNING: [msix] the manifest still carries placeholder identity values —
paste the ones from Partner Center before submitting
```

Leave `Version` alone. `build-msix.ps1` rewrites it from `package.json` on every
build, so the app version keeps exactly one source of truth.

---

## 3. Build

```powershell
pnpm build:msix                 # full build: frontend, Rust, stage, pack
powershell -File scripts/build-msix.ps1 -SkipBuild       # reuse the release binary
powershell -File scripts/build-msix.ps1 -DevCert         # + sign for local install
powershell -File scripts/build-msix.ps1 -CertificatePath cert.pfx -CertificatePassword '…'
```

| Flag | What it does |
|---|---|
| *(none)* | `pnpm tauri build --no-bundle`, then stage, version, pack |
| `-SkipBuild` | reuse `src-tauri/target/release/lumen.exe` — the fast path while iterating on the manifest |
| `-DevCert` | create (once) a self-signed certificate whose subject equals the manifest `Publisher`, and sign the package with it |
| `-CertificatePath` / `-CertificatePassword` | sign with an existing `.pfx`. Defaults to `LUMEN_SIGN_PFX` / `LUMEN_SIGN_PASSWORD` |

Step by step, the script:

1. reads `package.json` → `version`, and the manifest → `Identity`;
2. builds the release binary (unless `-SkipBuild`);
3. wipes and refills `src-tauri/target/msix/stage/` with
   `lumen.exe` + `AppxManifest.xml` + `Assets/*.png` (the icons are **copied from
   `src-tauri/icons/`**, never duplicated in the repo);
4. writes `Identity@Version` as `<version>.0` into the staged manifest;
5. runs `makeappx pack /d <stage> /p <out> /o`;
6. signs it if asked, then prints the path, size and identity.

Output:

```
src-tauri/target/msix/
  LUMEN_0.2.0.0_x64.msix      ← upload this to Partner Center
  stage/                      ← loose files, also usable with Add-AppxPackage -Register
```

The package contains **`lumen.exe` and nothing else** — the frontend is compiled
into the binary. There is no WebView2 payload: a *packaged* app runs against the
machine's Evergreen runtime, which is why the file is ~6 MiB rather than ~210 MiB.

---

## 4. Check it without installing anything

This is the cheap verification, and it catches the mistakes that actually happen
(identity not edited, version not bumped, a missing asset):

```powershell
$msix  = "src-tauri\target\msix\LUMEN_0.2.0.0_x64.msix"
$appx  = Get-AppPackageManifest -Path $msix     # not a real cmdlet: use makeappx
```

`makeappx` ships the unpack direction too:

```powershell
$sdk = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
        Sort-Object Name -Descending | Select-Object -First 1).FullName
& "$sdk\x64\makeappx.exe" unpack /p $msix /d src-tauri\target\msix\verify
Get-Content src-tauri\target\msix\verify\AppxManifest.xml | Select-String -Pattern '<Identity'
Get-ChildItem src-tauri\target\msix\verify -Recurse -File | Select-Object FullName
```

You should see `AppxManifest.xml`, `AppxBlockMap.xml`, `Assets\*.png` and
`lumen.exe`, and the `Identity` line should show **your** name, publisher and
`<version>.0`. `makeappx pack` already refuses anything that fails the AppX
schema, so a package that exists is structurally valid.

---

## 5. Install and launch it locally

The package has to be signed, and the signing certificate has to be trusted,
before Windows will install it. Two routes:

**A — signed package (closest to what the Store does)**

```powershell
# 1. build and sign with a self-signed certificate (no admin needed)
powershell -File scripts/build-msix.ps1 -DevCert

# 2. trust it for the local machine (THIS step needs Administrator)
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object FriendlyName -eq 'LUMEN MSIX development'
Export-Certificate -Cert $cert -FilePath lumen-dev.cer
Import-Certificate -FilePath lumen-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople

# 3. install
Add-AppxPackage src-tauri\target\msix\LUMEN_0.2.0.0_x64.msix
```

**B — loose files, no certificate (needs Developer Mode)**

Settings → System → For developers → **Developer Mode** on, then:

```powershell
Add-AppxPackage -Register src-tauri\target\msix\stage\AppxManifest.xml
```

Then confirm, in this order:

1. LUMEN is in the Start menu with the right name and icon;
2. it launches and shows the library — **the check that matters**, since the
   packaged app has no WebView2 of its own;
3. right-click a `.jpg` → *Open with* lists LUMEN;
4. a fresh library scans, indexes and renders thumbnails;
5. video playback works (the loopback media server is the one part of LUMEN that
   packaging could plausibly disturb);
6. uninstalling from Settings removes the package and its per-package data.

Clean up:

```powershell
Get-AppxPackage *LUMEN* | Remove-AppxPackage
```

> Windows requires a **higher** version to reinstall over an existing package. If
> the install complains about an older version, `Remove-AppxPackage` first, or
> bump `version` in `package.json`.

---

## 6. When something goes wrong

| Message | Cause and fix |
|---|---|
| `makeappx.exe not found — install the Windows SDK` | no `Windows Kits\10\bin\*\x64\makeappx.exe` on the machine. Install the SDK (or VS with the UWP workload); the script finds it automatically once it exists |
| `error C00CE014: … invalid child element 'RuntimeBehavior'` | `uap10:RuntimeBehavior` / `uap10:TrustLevel` were written as child elements. They are **attributes** of `<Application>` — see the manifest |
| `error C00CE015: … 'Wide310x310Logo' is not allowed in element 'DefaultTile'` | the SDK's schema in use rejects `uap:DefaultTile`. Remove that element — tiles are cosmetic and the Store listing images come from Partner Center |
| `failed to run powershell` while signing | Tauri runs `signCommand` with `src-tauri/` as the working directory, so the script path in `src-tauri/tauri.microsoftstore.conf.json` is `../scripts/sign-file.ps1`. Only relevant to the linked-installer route |
| `Add-AppxPackage : … 0x800B0109 … certificate … not trusted` | the signing certificate is not in `LocalMachine\TrustedPeople` — do §5 step A.2, or use route B |
| `Add-AppxPackage : … 0x80073CF3` / "a higher version" | a package with this identity and a higher version is already installed. `Remove-AppxPackage` first |
| `The app manifest must be valid as per schema` with no further detail | `makeappx` reports the line and column; the file it validated is `src-tauri/target/msix/stage/AppxManifest.xml`, which is generated — fix `src-tauri/msix/Package.appxmanifest`, not the staged copy |
| the app installs but shows nothing | the WebView2 runtime is missing on this machine (§1). Windows 11 always has it |

---

## 7. Versions

`package.json` is the only place a version is typed by hand:

```bash
# 1. bump the version in all three places
#    package.json · src-tauri/Cargo.toml · src-tauri/tauri.conf.json
# 2. move the CHANGELOG "Unreleased" section down
# 3. pnpm build:msix   → the package version follows automatically
```

`0.2.0` becomes `0.2.0.0`; the fourth field exists because MSIX versions have
four parts. The Store refuses a package whose version does not increase, so a
rebuild without a bump is only useful for local testing.

---

## 8. In CI

`.github/workflows/release.yml` does the same thing on a tag: it builds the MSIX,
signs it (with `LUMEN_SIGN_PFX_BASE64` / `LUMEN_SIGN_PASSWORD` if those secrets
exist, otherwise with a throwaway certificate), and attaches the `.msix` to the
draft release. You can also just run

```bash
gh run download <run-id>          # or take the file from the release page
```

and upload that artifact to Partner Center — the local machine is not required.

---

## 9. Why the package is small (and what that implies)

There is no WebView2 inside, on purpose:

- the **documented** way to make an MSIX pull in the WebView2 runtime
  (`win32dependencies:ExternalDependency`) does not work — Windows reports
  *"Declared namespace … is inapplicable, it will be ignored during manifest
  processing"* and there is no such dependency package in the Store;
- bundling the runtime as files is not possible from inside a package either;
- so the package relies on the machine's Evergreen runtime, which is part of
  Windows 11 and present on the vast majority of Windows 10 installs.

That is why §5 step 2 is worth doing on a clean machine before the first
submission: it is the one assumption this route rests on.
