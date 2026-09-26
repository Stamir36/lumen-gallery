# LUMEN on Android — building the APK

The desktop app is the primary target; Android is a companion build of the same
frontend and the same Rust core. This document is the map: what is already
prepared in the repository, what has to be installed once on the machine, and
what deliberately does **not** work on a phone yet.

> **Status:** the project is *prepared* for Android — platform-split Rust
> dependencies, mobile stubs for desktop-only modules, an APK script and the
> toolchain installer all exist. The first APK still needs the one-time
> toolchain install (≈1.5 GB, mostly the NDK) described below.

---

## 1. What is already done in the repository

| Piece | Where | Why it exists |
|---|---|---|
| Platform-split dependencies | `src-tauri/Cargo.toml` → `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` | The tray icon, HKCU file associations, the OS recycle bin and single-instance are desktop concepts. They are simply not in the dependency graph on Android. |
| Mobile stubs | `src-tauri/src/mobile_stubs.rs` | `tray::…` and `assoc::…` keep their signatures on mobile (`TrayMode`, `is_enabled`, the four assoc commands), so no `#[cfg]` leaks into shared code. Every stub answers "not available on this platform" — never a fake success. |
| Desktop-only plugins behind one seam | `src-tauri/src/lib.rs` → `desktop_plugins()` | `tauri-plugin-single-instance` is a desktop contract; the builder chain stays a single expression on both platforms. |
| Recycle bin refusal on mobile | `commands::trash_delete` | Scoped storage has no recycle bin. The command returns an error instead of unlinking — data loss is never the fallback. |
| Platform detector | `src/lib/platform.ts` | `isDesktop` / `isMobile` from the WebView UA. |
| Mobile-aware window chrome | `src/components/WindowTitleBar.tsx` | On a phone the OS owns window management: the minimize/maximize/close cluster and the drag strip are not rendered, so touches scroll the grid instead of dragging a window. |
| APK scripts | `package.json` | `android:init`, `android:dev`, `android:build`, `android:build:debug`. |
| Toolchain installer | `scripts/setup-android.ps1` | Checks JDK, installs cmdline-tools + platform + build-tools + NDK, adds the Rust targets, prints the env block. |

---

## 2. One-time toolchain install

Run the installer — it only touches your user profile (`%LOCALAPPDATA%\Android\Sdk`
and rustup), never the system:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-android.ps1
```

If you would rather do it by hand, this is exactly what it does:

| Requirement | Check | Install |
|---|---|---|
| JDK 17+ | `java -version` | Android Studio bundles one (`...\Android Studio\jbr`) — point `JAVA_HOME` at it. Java 8 is **not** enough for Gradle 8. |
| Android SDK, platform 35, build-tools 35 | `ls $env:ANDROID_HOME/platforms` | `sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"` |
| Command line tools | `ls $env:ANDROID_HOME/cmdline-tools/latest/bin` | <https://developer.android.com/studio#command-line-tools-only> — unpack into `cmdline-tools/latest` |
| NDK 27.x | `ls $env:ANDROID_HOME/ndk` | `sdkmanager "ndk;27.0.12077973"` (≈1 GB, the only heavy piece) |
| Rust Android targets | `rustup target list --installed` | `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

Then export (the installer prints this block ready to paste):

```powershell
$env:ANDROID_HOME     = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME        = "C:\Program Files\Android\Android Studio\jbr"
$env:NDK_HOME         = "$env:ANDROID_HOME\ndk\27.0.12077973"
$env:PATH             = "$env:PATH;$env:ANDROID_HOME\platform-tools"
```

`adb devices` must list your phone (enable *Developer options → USB debugging*,
then accept the pairing prompt on the phone).

---

## 3. Build the APK

```powershell
pnpm android:init     # once per checkout: generates src-tauri/gen/android
pnpm android:dev      # optional: hot-reload onto a connected phone
pnpm android:build    # release APK
pnpm android:build:debug   # debug APK (faster, keep it for field testing)
```

Where the artifact lands:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Install it directly:

```powershell
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

The debug build installs alongside the release one (`bundle.android.
debugApplicationIdSuffix = ".debug"` in `tauri.conf.json`), so both can live on
the phone at once.

### Signed release APK

`pnpm android:build` produces an **unsigned** universal APK. To ship it, either
sign it yourself:

```powershell
keytool -genkeypair -v -keystore lumen.jks -alias lumen -keyalg RSA -keysize 2048 -validity 10000
& "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" sign --ks lumen.jks `
  --out lumen-0.3.0.apk src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

…or let Gradle sign inside the init'd project (`src-tauri/gen/android/keystore.
properties` + `signingConfigs.release` in `app/build.gradle.kts`). The generated
project is committed (or regenerated with `android:init`) — treat it as project
code once it exists.

---

## 4. What works on the phone today, and what does not

**Works:** the whole UI shell, the SQLite library database, thumbnails, the
viewer, playback of files the app can reach, the tools hub (duplicates, disk
space), settings and the update check.

**Not yet mobile-aware** — these are the real gaps, in the order they should be
closed:

1. **Adding a library.** Desktop scans a filesystem path; Android 11+ hands apps
   scoped storage, so the folder picker has to go through the Storage Access
   Framework (`ACTION_OPEN_DOCUMENT_TREE`) and the scanner has to read documents
   through a content URI provider instead of `std::fs`. This is the main piece
   of work left, and it is also the prerequisite for everything below.
2. **File associations.** `assoc.rs` writes HKCU; on Android the equivalent is
   `intent-filter` entries in `AndroidManifest.xml` (generated project). The
   registry path simply is not used there.
3. **Recycle bin.** `trash_delete` refuses on mobile by design. A mobile
   replacement means the app's own trash folder (already modeled by the
   `trashed` column in the media table).
4. **Desktop chrome that does not exist there:** tray/background mode (Settings
   row is inert — the stub answers off), the mini player window (Android apps
   are single-window), window controls (hidden by `platform.ts`).
5. **File exchange with the PC** (the planned next feature) — that needs a
   transport (local network + pairing, or USB/ADB) and is out of scope of this
   preparation pass.

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `failed to ensure Android environment: Skipping Android Studio command line tools installation` | `cmdline-tools/latest` is missing — run `scripts/setup-android.ps1`. |
| `NDK not found` / `ANDROID_NDK_HOME` unset during build | The NDK was skipped or the path is wrong; check `$env:NDK_HOME`. |
| `Unsupported class file major version` / Gradle fails instantly | A Java 8 `java` is winning on `PATH`. Set `JAVA_HOME` to the Android Studio JBR. |
| `error: linker 'aarch64-linux-android-clang' not found` | NDK present but `NDK_HOME` not exported in the shell that runs the build. |
| `adb devices` shows nothing | USB debugging off, cable is charge-only, or the pairing prompt was dismissed on the phone. |
| First Gradle run downloads a lot | Normal — Gradle, the Android Gradle Plugin and the Rust artifacts are fetched once, then cached in `~/.gradle`. |
| `android:build` fails on `image` / `avif` | The AVIF codec in the `image` crate is heavy for Android; if the build complains, drop `avif` from the `image` features in `src-tauri/Cargo.toml` for the mobile profile. |

---

## 6. Version pinning made simple

`tauri.android.init` reads the same `tauri.conf.json`: `productName` becomes the
app label, `identifier` (`com.unesell.lumen`) becomes the package id, and
`version` (0.3.0) becomes `versionName`. Bump `version` in `package.json`,
`tauri.conf.json` and `Cargo.toml` together — the MSIX script and the Android
project both read from there.
