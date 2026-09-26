<#
  Package LUMEN as an MSIX for the Microsoft Store.

  Why MSIX: the Store signs the package for free and hosts it, so a Store MSIX
  submission needs no code-signing certificate and no download URL of your own.
  (The EXE/MSI route needs a CA certificate and a stable non-redirecting host --
  see the "Where it has to be hosted" section of docs/MICROSOFT-STORE.md.)

  What this does:
    1. builds the release binary (`pnpm tauri build --no-bundle`)
    2. stages lumen.exe + AppxManifest.xml + Assets into a clean folder
    3. rewrites Identity@Version from package.json (single source of truth)
    4. runs makeappx from the newest Windows SDK
    5. optionally signs with a self-signed development certificate

  The package only carries lumen.exe: the frontend is compiled into it, and the
  WebView2 runtime is not bundled at all -- a packaged app gets the machine's
  Evergreen runtime, which every Windows 11 device has.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/build-msix.ps1
    powershell -ExecutionPolicy Bypass -File scripts/build-msix.ps1 -DevCert
    powershell -ExecutionPolicy Bypass -File scripts/build-msix.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
  # Create (once) a self-signed certificate whose subject matches the manifest
  # Publisher, and sign the package with it. Required for Add-AppxPackage on a
  # machine that has not trusted the certificate yet.
  [switch] $DevCert,

  # Sign with an existing .pfx instead. Its subject must match the Publisher.
  [string] $CertificatePath = $env:LUMEN_SIGN_PFX,
  [string] $CertificatePassword = $env:LUMEN_SIGN_PASSWORD,

  # Reuse the existing release binary.
  [switch] $SkipBuild
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Find-SdkTool([string] $Name) {
  $onPath = Get-Command $Name -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path -LiteralPath $kits) {
    foreach ($kit in (Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending)) {
      $candidate = Join-Path $kit.FullName "x64\$Name"
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  return $null
}

$makeappx = Find-SdkTool 'makeappx.exe'
$signtool = Find-SdkTool 'signtool.exe'
if (-not $makeappx) {
  Write-Error '[msix] makeappx.exe not found - install the Windows SDK (or Visual Studio with the UWP workload)'
  exit 1
}

$manifestSource = Join-Path $root 'src-tauri\msix\Package.appxmanifest'
if (-not (Test-Path -LiteralPath $manifestSource)) {
  Write-Error "[msix] $manifestSource is missing"
  exit 1
}

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = "$($package.version).0"

[xml] $manifest = Get-Content -LiteralPath $manifestSource -Raw
$identity = $manifest.Package.Identity
$publisher = $identity.Publisher
$identityName = $identity.Name

if ($publisher -like '*EDIT-ME*' -or $identityName -like '*EDIT-ME*') {
  Write-Warning '[msix] the manifest still carries placeholder identity values - paste the ones from Partner Center > Product identity before submitting'
}

if ($SkipBuild) {
  Write-Host '[msix] reusing the existing release binary'
} else {
  Write-Host '[msix] building the release binary...'
  & pnpm tauri build --no-bundle
  if ($LASTEXITCODE -ne 0) { Write-Error '[msix] build failed'; exit $LASTEXITCODE }
}

$exe = Join-Path $root 'src-tauri\target\release\lumen.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Error "[msix] $exe is missing - run without -SkipBuild"
  exit 1
}

# ---- stage ------------------------------------------------------------------
$msixRoot = Join-Path $root 'src-tauri\target\msix'
$stage = Join-Path $msixRoot 'stage'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets -Force | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'lumen.exe')

# The MSIX assets are the Tauri icon set; no second copy is kept in the repo.
foreach ($icon in 'StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Square310x310Logo.png') {
  $source = Join-Path $root "src-tauri\icons\$icon"
  if (-not (Test-Path -LiteralPath $source)) { Write-Error "[msix] src-tauri\icons\$icon is missing"; exit 1 }
  Copy-Item -LiteralPath $source -Destination (Join-Path $assets $icon)
}

$identity.Version = $version
$stagedManifest = Join-Path $stage 'AppxManifest.xml'
$manifest.Save($stagedManifest)

Write-Host "[msix] staged $version for $identityName ($publisher)"

# ---- pack -------------------------------------------------------------------
$out = Join-Path $msixRoot "LUMEN_${version}_x64.msix"
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

Write-Host "[msix] $makeappx pack /d $stage /p $out"
& $makeappx pack /d $stage /p $out /o
if ($LASTEXITCODE -ne 0) { Write-Error '[msix] makeappx failed'; exit $LASTEXITCODE }

# ---- sign -------------------------------------------------------------------
$pfx = $CertificatePath

if ($DevCert) {
  $subject = $publisher
  $existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $subject } | Select-Object -First 1
  if ($existing) {
    Write-Host "[msix] reusing the development certificate $($existing.Thumbprint)"
  } else {
    Write-Host "[msix] creating a self-signed development certificate for $subject"
    $existing = New-SelfSignedCertificate -Type Custom -Subject $subject `
      -KeyUsage DigitalSignature -FriendlyName 'LUMEN MSIX development' `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  }
  if (-not $signtool) { Write-Error '[msix] signtool.exe not found'; exit 1 }
  Write-Host "[msix] $signtool sign /fd SHA256 /sha1 $($existing.Thumbprint) $out"
  & $signtool sign /fd SHA256 /sha1 $existing.Thumbprint $out
  if ($LASTEXITCODE -ne 0) { Write-Error '[msix] signtool failed'; exit $LASTEXITCODE }
} elseif ($pfx) {
  if (-not $signtool) { Write-Error '[msix] signtool.exe not found'; exit 1 }
  $signArgs = @('sign', '/fd', 'SHA256', '/f', $pfx)
  if ($CertificatePassword) { $signArgs += @('/p', $CertificatePassword) }
  $signArgs += $out
  Write-Host "[msix] $signtool $($signArgs -join ' ')"
  & $signtool @signArgs
  if ($LASTEXITCODE -ne 0) { Write-Error '[msix] signtool failed'; exit $LASTEXITCODE }
} else {
  Write-Warning '[msix] unsigned package - pass -DevCert (or LUMEN_SIGN_PFX) before installing it locally'
}

$size = [math]::Round((Get-Item -LiteralPath $out).Length / 1MB, 1)
Write-Host ''
Write-Host "[msix] package : $out"
Write-Host "[msix] size    : $size MiB"
Write-Host "[msix] identity: $identityName | $publisher | $version | x64"
Write-Host '[msix] next    : Partner Center > your MSIX product > Packages > upload this .msix'

exit 0
