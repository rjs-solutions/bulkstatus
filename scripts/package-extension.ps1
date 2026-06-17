param(
  [string]$ExtensionDir = "$PSScriptRoot\..\extension",
  [string]$DistDir = "$PSScriptRoot\..\dist",
  [string]$PackageName = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$extensionPath = Resolve-Path -LiteralPath $ExtensionDir
$manifestPath = Join-Path $extensionPath.Path "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "No manifest.json found at $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($PackageName)) {
  $PackageName = "bulkstatus-$($manifest.version).zip"
}

if (-not (Test-Path -LiteralPath $DistDir)) {
  New-Item -ItemType Directory -Path $DistDir | Out-Null
}

$distPath = Resolve-Path -LiteralPath $DistDir
$archivePath = Join-Path $distPath.Path $PackageName
$archiveFullPath = [System.IO.Path]::GetFullPath($archivePath)

if (-not $archiveFullPath.StartsWith($distPath.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Archive path escaped dist directory: $archiveFullPath"
}

if (Test-Path -LiteralPath $archiveFullPath) {
  Remove-Item -LiteralPath $archiveFullPath -Force
}

Compress-Archive -Path (Join-Path $extensionPath.Path "*") -DestinationPath $archiveFullPath -Force

$zip = [System.IO.Compression.ZipFile]::OpenRead($archiveFullPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }

  if ($entries -notcontains "manifest.json") {
    throw "Package validation failed: manifest.json is not at the ZIP root."
  }

  if ($entries -contains "extension/manifest.json") {
    throw "Package validation failed: extension folder was zipped instead of its contents."
  }
}
finally {
  $zip.Dispose()
}

Write-Output "Created $archiveFullPath"

