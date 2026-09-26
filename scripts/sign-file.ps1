<#
  Sign a PE file for the Microsoft Store submission.

  `src-tauri/tauri.microsoftstore.conf.json` points
  `bundle > windows > signCommand` at this script, so Tauri calls it for the
  application binary that goes *inside* the installer as well as for the
  installer itself. A linked EXE/MSI product must have **every** PE file signed
  with a certificate that chains to a CA in the Microsoft Trusted Root Program:

    https://learn.microsoft.com/windows/apps/publish/publish-your-app/msi/app-package-requirements

  With no certificate configured this is a deliberate no-op, so the Store
  installer can still be built and inspected on a machine that has no signing
  material yet. Configure one of:

    LUMEN_SIGN_PFX         path to a .pfx / .p12 code-signing certificate
    LUMEN_SIGN_PASSWORD    that certificate's password
    LUMEN_SIGN_THUMBPRINT  SHA-1 thumbprint of a certificate in the user store
    LUMEN_SIGN_TIMESTAMP   RFC 3161 timestamp server (default: DigiCert)

  What Tauri runs (the binary path replaces `%1`):

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sign-file.ps1 <file>
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Target
)

$ErrorActionPreference = 'Stop'

if (-not $Target -or $Target.Count -eq 0) {
  Write-Error '[sign] no file was passed - nothing to sign'
  exit 1
}

$file = (Resolve-Path -LiteralPath $Target[0]).Path

$pfx = $env:LUMEN_SIGN_PFX
$password = $env:LUMEN_SIGN_PASSWORD
$thumbprint = $env:LUMEN_SIGN_THUMBPRINT
$timestamp = if ($env:LUMEN_SIGN_TIMESTAMP) { $env:LUMEN_SIGN_TIMESTAMP } else { 'http://timestamp.digicert.com' }

if (-not $pfx -and -not $thumbprint) {
  Write-Host "[sign] no certificate configured (LUMEN_SIGN_PFX / LUMEN_SIGN_THUMBPRINT) - leaving $file unsigned"
  exit 0
}

# signtool ships with the Windows SDK and is not always on PATH.
$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (-not $signtool) {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path -LiteralPath $kits) {
    foreach ($kit in (Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending)) {
      $candidate = Join-Path $kit.FullName 'x64\signtool.exe'
      if (Test-Path -LiteralPath $candidate) { $signtool = $candidate; break }
    }
  }
}
if (-not $signtool) {
  Write-Error '[sign] signtool.exe not found - install the Windows SDK signing tools'
  exit 1
}

$signArgs = @('sign', '/fd', 'SHA256', '/tr', $timestamp, '/td', 'SHA256')
if ($thumbprint) {
  $signArgs += @('/sha1', $thumbprint, '/s', 'My')
} else {
  $signArgs += @('/f', $pfx)
  if ($password) { $signArgs += @('/p', $password) }
}
$signArgs += $file

Write-Host "[sign] $signtool $($signArgs -join ' ')"
& $signtool @signArgs
if ($LASTEXITCODE -ne 0) {
  Write-Error "[sign] signtool failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

$status = (Get-AuthenticodeSignature -LiteralPath $file).Status
Write-Host "[sign] $file -> $status"
if ($status -ne 'Valid') {
  Write-Error "[sign] signature did not validate ($status)"
  exit 1
}
