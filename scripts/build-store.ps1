<#
  Build the LUMEN installer that the Microsoft Store links to.

  The Store rejects a Win32 submission whose installer is a downloader stub: it
  has to install silently, with no user interface and no downloads during setup.
  Tauri's normal release bundle downloads the WebView2 runtime at install time,
  which is exactly what fails the Store's package validation, so this script
  bundles with `src-tauri/tauri.microsoftstore.conf.json` instead - the WebView2
  offline runtime travels inside the installer (hence ~210 MB).

  Signing happens through Tauri's `signCommand`, which calls
  `scripts/sign-file.ps1` for both the application binary and the installer. Set
  `LUMEN_SIGN_PFX` (+ `LUMEN_SIGN_PASSWORD`) or `LUMEN_SIGN_THUMBPRINT` before
  running, otherwise the result stays unsigned and cannot be submitted.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/build-store.ps1
    powershell -ExecutionPolicy Bypass -File scripts/build-store.ps1 -TestSilentInstall
#>
[CmdletBinding()]
param(
  # Actually runs `<installer> /S` afterwards. Installs LUMEN for the current
  # user, so it is off by default.
  [switch] $TestSilentInstall
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$bundleDir = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$installer = Join-Path $bundleDir "LUMEN_${version}_x64-setup.exe"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error '[store] pnpm is not on PATH - install Node.js and pnpm first'
  exit 1
}

$signed = $env:LUMEN_SIGN_PFX -or $env:LUMEN_SIGN_THUMBPRINT
if (-not $signed) {
  Write-Warning '[store] no signing certificate configured - the installer will be UNSIGNED and the Store will reject it'
}

Write-Host "[store] bundling LUMEN $version for the Microsoft Store (offline WebView2, ~210 MB)..."
& pnpm tauri bundle --config src-tauri/tauri.microsoftstore.conf.json
if ($LASTEXITCODE -ne 0) {
  Write-Error '[store] bundle failed'
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $installer)) {
  Write-Error "[store] expected $installer but it is not there"
  exit 1
}

$size = (Get-Item -LiteralPath $installer).Length
$status = (Get-AuthenticodeSignature -LiteralPath $installer).Status

Write-Host ''
Write-Host "[store] installer : $installer"
Write-Host "[store] size      : $([math]::Round($size / 1MB, 1)) MiB ($size bytes)"
Write-Host "[store] signature : $status"

if ($size -gt 100MB) {
  Write-Host '[store] note      : larger than GitHub''s 100 MiB per-file limit - publish it as a'
  Write-Host '                    release asset and let .github/workflows/pages.yml mirror it into'
  Write-Host '                    the site, instead of committing it'
}

if ($status -ne 'Valid') {
  Write-Warning '[store] the Store requires the installer AND every PE file inside it to be signed'
}

if ($TestSilentInstall) {
  Write-Host "[store] running the silent install check: $installer /S"
  $proc = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  Write-Host "[store] /S exited with code $($proc.ExitCode)"

  $entry = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'LUMEN*' }
  if ($entry) {
    Write-Host "[store] Add/Remove Programs entry: DisplayName='$($entry.DisplayName)' Publisher='$($entry.Publisher)' Version='$($entry.DisplayVersion)'"
  } else {
    Write-Warning '[store] no Add/Remove Programs entry was created - the Store check looks for exactly this'
  }
}

exit 0
