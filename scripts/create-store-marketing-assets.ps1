param(
  [string]$StoreDir = "$PSScriptRoot\..\dist\store-listing",
  [string]$Version,
  [string]$RawDir,
  [string]$IconPath = "$PSScriptRoot\..\extension\assets\icons\icon-128.png"
)

$ErrorActionPreference = "Stop"

# Default the raw-capture folder to the current manifest version, e.g.
# dist\store-listing\raw-captures-0.1.36. Drop the raw 5 captures there before running.
# The icon is always pulled from extension\assets\icons\icon-128.png, so updating the
# extension icon automatically refreshes every marketing screenshot and promo tile here.
if (-not $Version) {
  $versionManifest = Get-Content -LiteralPath "$PSScriptRoot\..\extension\manifest.json" -Raw | ConvertFrom-Json
  $Version = $versionManifest.version
}
if (-not $RawDir) {
  $RawDir = "$StoreDir\raw-captures-$Version"
}
if (-not (Test-Path -LiteralPath $RawDir)) {
  throw "Raw capture folder not found: $RawDir. Capture the 5 raw screenshots first (see docs\SCREENSHOTS.md)."
}

Add-Type -AssemblyName System.Drawing

$marketingDir = Join-Path $StoreDir "screenshots-marketing"
$screenshotsDir = Join-Path $StoreDir "screenshots"
$promoDir = Join-Path $StoreDir "promo-tiles"

New-Item -ItemType Directory -Force -Path $marketingDir | Out-Null
New-Item -ItemType Directory -Force -Path $screenshotsDir | Out-Null
New-Item -ItemType Directory -Force -Path $promoDir | Out-Null

function New-Rect {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height)
  return [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height)
}

function Add-RoundedRectangle {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $Path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $Path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $Path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $Path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $Path.CloseFigure()
}

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $path (New-Rect $X $Y $Width $Height) $Radius
  return $path
}

function Fill-RoundedRect {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius,
    [System.Drawing.Brush]$Brush,
    [System.Drawing.Pen]$Pen = $null
  )

  $path = New-RoundedPath $X $Y $Width $Height $Radius
  $Graphics.FillPath($Brush, $path)
  if ($null -ne $Pen) {
    $Graphics.DrawPath($Pen, $path)
  }
  $path.Dispose()
}

function Draw-Text {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Text,
    [System.Drawing.Font]$Font,
    [System.Drawing.Brush]$Brush,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height
  )

  $format = [System.Drawing.StringFormat]::new()
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
  $Graphics.DrawString($Text, $Font, $Brush, (New-Rect $X $Y $Width $Height), $format)
  $format.Dispose()
}

function Draw-Chips {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string[]]$Labels,
    [float]$X,
    [float]$Y,
    [System.Drawing.Font]$Font,
    [System.Drawing.Brush]$TextBrush
  )

  $chipBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 238, 243, 252))
  $chipPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 223, 231, 243), 1)
  $cursor = $X

  foreach ($label in $Labels) {
    $size = $Graphics.MeasureString($label, $Font)
    $width = [Math]::Ceiling($size.Width) + 34
    Fill-RoundedRect $Graphics $cursor $Y $width 34 17 $chipBrush $chipPen
    Draw-Text $Graphics $label $Font $TextBrush ($cursor + 17) ($Y + 7) ($width - 34) 20
    $cursor += $width + 12
  }

  $chipBrush.Dispose()
  $chipPen.Dispose()
}

function Draw-AppPreview {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$RawImage,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$CropY = 0
  )

  $shadow1 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 15, 23, 42))
  $shadow2 = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(18, 37, 99, 235))
  $frameBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $framePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 202, 213, 226), 1)

  Fill-RoundedRect $Graphics ($X + 12) ($Y + 14) $Width $Height 24 $shadow1
  Fill-RoundedRect $Graphics ($X + 22) ($Y + 22) $Width $Height 24 $shadow2
  Fill-RoundedRect $Graphics $X $Y $Width $Height 24 $frameBrush $framePen

  $innerX = $X + 18
  $innerY = $Y + 14
  $innerWidth = $Width - 36
  $innerHeight = $Height - 28
  $clipPath = New-RoundedPath $innerX $innerY $innerWidth $innerHeight 15
  $oldClip = $Graphics.Clip
  $Graphics.SetClip($clipPath)

  $scale = $innerWidth / $RawImage.Width
  $drawWidth = $innerWidth
  $drawHeight = $RawImage.Height * $scale
  if ($drawHeight -lt $innerHeight) {
    $scale = $innerHeight / $RawImage.Height
    $drawHeight = $innerHeight
    $drawWidth = $RawImage.Width * $scale
  }

  $drawX = $innerX + (($innerWidth - $drawWidth) / 2)
  $drawY = $innerY - ($CropY * $scale)
  $Graphics.DrawImage($RawImage, (New-Rect $drawX $drawY $drawWidth $drawHeight))
  $Graphics.Clip = $oldClip
  $clipPath.Dispose()
  $oldClip.Dispose()

  $shadow1.Dispose()
  $shadow2.Dispose()
  $frameBrush.Dispose()
  $framePen.Dispose()
}

function Save-Png {
  param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-MarketingScreenshot {
  param(
    [string]$RawFile,
    [string]$OutputFile,
    [string]$Headline,
    [string]$Body,
    [string[]]$Chips,
    [float]$CropY = 0
  )

  $rawPath = Join-Path $RawDir $RawFile
  $outputPath = Join-Path $marketingDir $OutputFile
  $raw = [System.Drawing.Image]::FromFile($rawPath)
  $icon = [System.Drawing.Image]::FromFile($IconPath)
  $bitmap = [System.Drawing.Bitmap]::new(1280, 800)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 248, 252))
  $cardBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $cardPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 213, 224, 238), 1)
  $headlineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 6, 16, 39))
  $bodyBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 59, 83))
  $blueBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 37, 99, 235))

  $brandFont = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brandSubFont = [System.Drawing.Font]::new("Segoe UI", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $headlineFont = [System.Drawing.Font]::new("Segoe UI", 36, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new("Segoe UI", 21, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $chipFont = [System.Drawing.Font]::new("Segoe UI", 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

  $graphics.FillRectangle($background, 0, 0, 1280, 800)
  Fill-RoundedRect $graphics 42 30 1196 738 30 $cardBrush $cardPen

  # Brand block intentionally omitted: the app's own header (visible in every capture)
  # and the store listing already carry the BulkStatus name + icon, so repeating it here
  # just wastes space. Headline/body/chips moved up and the preview window enlarged.
  Draw-Text $graphics $Headline $headlineFont $headlineBrush 88 64 1100 48
  Draw-Text $graphics $Body $bodyFont $bodyBrush 88 120 1100 58
  Draw-Chips $graphics $Chips 84 182 $chipFont $blueBrush
  Draw-AppPreview $graphics $raw 78 228 1124 512 $CropY

  Save-Png $bitmap $outputPath

  $background.Dispose()
  $cardBrush.Dispose()
  $cardPen.Dispose()
  $headlineBrush.Dispose()
  $bodyBrush.Dispose()
  $blueBrush.Dispose()
  $brandFont.Dispose()
  $brandSubFont.Dispose()
  $headlineFont.Dispose()
  $bodyFont.Dispose()
  $chipFont.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $raw.Dispose()
  $icon.Dispose()

  Write-Output "Created $outputPath"
}

function New-PlainScreenshot {
  param([string]$RawFile, [string]$OutputFile)
  $rawPath = Join-Path $RawDir $RawFile
  $outputPath = Join-Path $screenshotsDir $OutputFile
  $raw = [System.Drawing.Image]::FromFile($rawPath)
  $bitmap = [System.Drawing.Bitmap]::new(1280, 800)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($raw, (New-Rect 0 0 1280 800))
  Save-Png $bitmap $outputPath
  $graphics.Dispose()
  $bitmap.Dispose()
  $raw.Dispose()
  Write-Output "Created $outputPath"
}

function New-PromoTile {
  param(
    [string]$OutputFile,
    [int]$Width,
    [int]$Height,
    [string]$Headline,
    [string]$Body
  )

  $outputPath = Join-Path $promoDir $OutputFile
  $icon = [System.Drawing.Image]::FromFile($IconPath)
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new((New-Rect 0 0 $Width $Height), [System.Drawing.Color]::FromArgb(255, 245, 248, 252), [System.Drawing.Color]::FromArgb(255, 224, 235, 251), [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $blueBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
  $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 6, 16, 39))
  $bodyBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 59, 83))

  $titleSize = if ($Width -gt 800) { 48 } else { 26 }
  $bodySize = if ($Width -gt 800) { 24 } else { 14 }
  $brandSize = if ($Width -gt 800) { 30 } else { 18 }
  $iconSize = if ($Width -gt 800) { 132 } else { 74 }
  $pad = if ($Width -gt 800) { 78 } else { 28 }

  $titleFont = [System.Drawing.Font]::new("Segoe UI", $titleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new("Segoe UI", $bodySize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brandFont = [System.Drawing.Font]::new("Segoe UI", $brandSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

  $graphics.FillRectangle($background, 0, 0, $Width, $Height)
  $graphics.DrawImage($icon, (New-Rect $pad $pad $iconSize $iconSize))
  Draw-Text $graphics "BulkStatus" $brandFont $blueBrush ($pad + $iconSize + 20) ($pad + 8) ($Width - $pad - $iconSize - 60) 44
  Draw-Text $graphics $Headline $titleFont $titleBrush $pad ($pad + $iconSize + 35) ($Width - ($pad * 2)) ([Math]::Max(70, $Height * .22))
  Draw-Text $graphics $Body $bodyFont $bodyBrush $pad ($pad + $iconSize + 115) ($Width - ($pad * 2)) ([Math]::Max(46, $Height * .20))

  Save-Png $bitmap $outputPath

  $background.Dispose()
  $blueBrush.Dispose()
  $titleBrush.Dispose()
  $bodyBrush.Dispose()
  $titleFont.Dispose()
  $bodyFont.Dispose()
  $brandFont.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $icon.Dispose()

  Write-Output "Created $outputPath"
}

$screenshots = @(
  @{
    Raw = "01-inputs-raw.png"
    Marketing = "01-input-sources-marketing-1280x800.png"
    Plain = "01-inputs-1280x800.png"
    Headline = "Start from the sources you already have"
    Body = "Paste URLs, upload a TXT/CSV, or load an XML sitemap or llms.txt source, then run the check."
    Chips = @("Paste URLs", "Upload CSV", "Sitemaps")
  },
  @{
    Raw = "02-summary-raw.png"
    Marketing = "02-summary-metrics-marketing-1280x800.png"
    Plain = "02-summary-1280x800.png"
    Headline = "Know the health of every URL at a glance"
    Body = "Summary metrics break down status groups, redirects, issues, and skipped rows after each crawl."
    Chips = @("Status mix", "Issue counts", "Export summary")
  },
  @{
    Raw = "03-results-raw.png"
    Marketing = "03-results-table-marketing-1280x800.png"
    Plain = "03-results-1280x800.png"
    Headline = "Review every result in a sortable table"
    Body = "Filter, sort, page through results, and export CSV files for reporting or follow-up."
    Chips = @("Filters", "Pagination", "CSV export")
  },
  @{
    Raw = "04-settings-raw.png"
    Marketing = "04-settings-marketing-1280x800.png"
    Plain = "04-settings-1280x800.png"
    Headline = "Tune the crawl to the site"
    Body = "Use presets or adjust rendering, speed, timeouts, link/image checks, and the visible result columns."
    Chips = @("Presets", "JavaScript rendering", "Table columns")
  },
  @{
    Raw = "05-dark-mode-raw.png"
    Marketing = "05-dark-mode-marketing-1280x800.png"
    Plain = "05-dark-mode-1280x800.png"
    Headline = "Comfortable in light or dark mode"
    Body = "Readable themes, adjustable result density, and diagnostics controls keep longer audits manageable."
    Chips = @("Dark mode", "Result density", "Diagnostics")
  }
)

foreach ($shot in $screenshots) {
  $cropY = 0
  if ($shot.ContainsKey("CropY")) {
    $cropY = $shot.CropY
  }
  New-MarketingScreenshot -RawFile $shot.Raw -OutputFile $shot.Marketing -Headline $shot.Headline -Body $shot.Body -Chips $shot.Chips -CropY $cropY
  New-PlainScreenshot -RawFile $shot.Raw -OutputFile $shot.Plain
}

New-PromoTile -OutputFile "small-promo-tile-440x280.png" -Width 440 -Height 280 -Headline "Bulk URL Checker & Crawler" -Body "Crawl & bulk-check status, links, images & SEO metadata - export to CSV."
New-PromoTile -OutputFile "marquee-promo-tile-1400x560.png" -Width 1400 -Height 560 -Headline "Crawl & bulk-check URLs for broken links, redirects & SEO" -Body "Run focused crawls, review summary metrics, sort and filter results, and export CSV - all from Chrome."
