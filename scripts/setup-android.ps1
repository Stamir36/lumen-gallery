<#
.SYNOPSIS
  One-time Android toolchain setup for LUMEN (APK build).

.DESCRIPTION
  Checks the four things `tauri android` needs and installs what is missing:

    1. JDK 17+            (Android Studio's bundled JBR is used when present)
    2. Android SDK        (cmdline-tools + platform + build-tools)
    3. Android NDK        (the Rust cross-compiler toolchain)
    4. Rust android targets (aarch64 + armv7 + x86_64)

  Nothing is installed silently into the system: the SDK lives in the user
  profile, Rust targets are user-level rustup components, and the script only
  PRINTS the environment variables to export. Run it, copy the env block it
  prints into your shell, then:

      pnpm android:init     # once, creates src-tauri/gen/android
      pnpm android:build    # builds the release APK

.PARAMETER SdkPath
  Where the Android SDK lives / should live.
  Default: $env:LOCALAPPDATA\Android\Sdk

.PARAMETER SkipNdk
  Skip the NDK install (~1 GB). `tauri android init` still works, but no build.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-android.ps1
#>
[CmdletBinding()]
param(
  [string]$SdkPath = (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
  [switch]$SkipNdk
)

$ErrorActionPreference = 'Stop'

# Tauri 2.11 defaults: compileSdk 35, NDK 27.x, JDK 17.
$Platform = 'android-35'
$BuildTools = '35.0.0'
$NdkVersion = '27.0.12077973'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "   ok   $text" -ForegroundColor Green }
function Warn($text) { Write-Host "   !!   $text" -ForegroundColor Yellow }

Write-Host "LUMEN — Android toolchain check" -ForegroundColor White
Write-Host "SDK target: $SdkPath"

# ---------------------------------------------------------------- 1. JDK 17+
Step 'JDK'
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
$javaHome = $null
if (Test-Path (Join-Path $jbr 'bin\java.exe')) {
  $javaHome = $jbr
  Ok "Android Studio JBR found: $jbr"
} else {
  $candidates = @(
    "$env:ProgramFiles\Eclipse Adoptium\jdk-17*",
    "$env:ProgramFiles\Microsoft\jdk-17*",
    "$env:ProgramFiles\Java\jdk-17*"
  )
  foreach ($pattern in $candidates) {
    $hit = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $javaHome = $hit.FullName; break }
  }
  if ($javaHome) { Ok "JDK found: $javaHome" }
  else { Warn 'No JDK 17 found. Install Android Studio (bundles the JBR) or Temurin 17.' }
}

# ------------------------------------------------------------- 2. Android SDK
Step 'Android SDK'
if (-not (Test-Path $SdkPath)) { New-Item -ItemType Directory -Path $SdkPath -Force | Out-Null }

$sdkManager = Get-ChildItem -Path (Join-Path $SdkPath 'cmdline-tools') -Filter sdkmanager.bat -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $sdkManager) {
  Warn 'cmdline-tools missing — downloading the official command line tools.'
  $zip = Join-Path $env:TEMP 'android-cmdline-tools.zip'
  $url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $dest = Join-Path $SdkPath 'cmdline-tools\latest'
  Expand-Archive -Path $zip -DestinationPath $dest -Force
  Remove-Item $zip -Force
  # the archive nests a `cmdline-tools` folder — sdkmanager expects it flattened
  $nested = Join-Path $dest 'cmdline-tools'
  if (Test-Path $nested) {
    Get-ChildItem $nested | Move-Item -Destination $dest -Force
    Remove-Item $nested -Recurse -Force
  }
  $sdkManager = Get-ChildItem -Path (Join-Path $SdkPath 'cmdline-tools') -Filter sdkmanager.bat -Recurse |
    Select-Object -First 1
}
if (-not $sdkManager) { throw 'cmdline-tools still missing — install them from Android Studio > SDK Manager.' }
Ok "sdkmanager: $($sdkManager.FullName)"

# licenses first: sdkmanager refuses to install without them
Step 'Licenses'
& $sdkManager.FullName --sdk_root="$SdkPath" --licenses | Out-Null
Ok 'licenses accepted'

Step 'SDK packages'
$packages = @("platforms;$Platform", "build-tools;$BuildTools", 'platform-tools')
if (-not $SkipNdk) { $packages += "ndk;$NdkVersion" }
& $sdkManager.FullName --sdk_root="$SdkPath" @packages
Ok ("installed: " + ($packages -join ', '))

# ---------------------------------------------------------- 3. Rust targets
Step 'Rust targets'
$targets = @('aarch64-linux-android', 'armv7-linux-androideabi', 'x86_64-linux-android')
foreach ($t in $targets) {
  rustup target add $t 2>&1 | Out-Null
}
Ok ("rustup targets: " + ($targets -join ', '))

# --------------------------------------------------------------- 4. Summary
$ndkPath = Join-Path $SdkPath "ndk\$NdkVersion"
Step 'Done — export this before building'
@"
`$env:ANDROID_HOME        = "$SdkPath"
`$env:ANDROID_SDK_ROOT    = "$SdkPath"
`$env:JAVA_HOME           = "$javaHome"
`$env:NDK_HOME            = "$ndkPath"
`$env:PATH                = "`$env:PATH;$SdkPath\platform-tools"
"@ | Write-Host

if ($SkipNdk) { Warn 'NDK was skipped: `pnpm android:build` will fail until it is installed.' }
Write-Host "`nNext: pnpm android:init   (once)   then   pnpm android:build" -ForegroundColor White
Write-Host "APK lands in src-tauri\gen\android\app\build\outputs\apk\universal\release\" -ForegroundColor White
