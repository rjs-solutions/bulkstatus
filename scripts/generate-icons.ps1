param(
  [string]$OutputDir = "$PSScriptRoot\..\extension\assets\icons"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

# Procedural redraw of extension\assets\icons\icon-source.svg (the 2-row "stacked pages
# with a green check and red x" design). Coordinates below are the SVG elements mapped
# into 128x128 canvas space (the SVG's group transform already applied), so the PNGs match
# the source SVG. The front page uses a uniform, subtle off-white -> light-gray fill (no
# pure white) to avoid the stray white band the old gradient produced.

$sizes = @(16, 32, 48, 128)

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

function New-ScaledRect {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Scale)
  return [System.Drawing.RectangleF]::new($X * $Scale, $Y * $Scale, $Width * $Scale, $Height * $Scale)
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
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius, [float]$Scale)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $path (New-ScaledRect $X $Y $Width $Height $Scale) ($Radius * $Scale)
  return $path
}

function New-GradientBrush {
  param(
    [float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Scale,
    [System.Drawing.Color]$StartColor, [System.Drawing.Color]$EndColor
  )
  $rect = New-ScaledRect $X $Y $Width $Height $Scale
  return [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $StartColor, $EndColor, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
}

function Draw-RoundedLayer {
  param(
    [System.Drawing.Graphics]$Graphics, [float]$Scale,
    [float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius,
    [System.Drawing.Brush]$Brush, [System.Drawing.Pen]$Pen = $null
  )
  $path = New-RoundedPath $X $Y $Width $Height $Radius $Scale
  $Graphics.FillPath($Brush, $path)
  if ($null -ne $Pen) {
    $Graphics.DrawPath($Pen, $path)
  }
  $path.Dispose()
}

function Draw-ScaledLine {
  param(
    [System.Drawing.Graphics]$Graphics, [System.Drawing.Pen]$Pen, [float]$Scale,
    [float]$X1, [float]$Y1, [float]$X2, [float]$Y2
  )
  $Graphics.DrawLine($Pen, $X1 * $Scale, $Y1 * $Scale, $X2 * $Scale, $Y2 * $Scale)
}

function Fill-Circle {
  param(
    [System.Drawing.Graphics]$Graphics, [float]$Scale,
    [float]$CenterX, [float]$CenterY, [float]$Radius, [System.Drawing.Brush]$Brush
  )
  $Graphics.FillEllipse($Brush, (New-ScaledRect ($CenterX - $Radius) ($CenterY - $Radius) ($Radius * 2) ($Radius * 2) $Scale))
}

foreach ($size in $sizes) {
  $scale = $size / 128
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  # Back page (dark slate) - #46566b
  $backBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 70, 86, 107))
  Draw-RoundedLayer $graphics $scale 34.6 3.0 79.1 110.7 14.7 $backBrush

  # Front page - uniform subtle off-white -> light-gray, with a soft border (#c4cfdb).
  $frontBrush = New-GradientBrush 14.3 14.3 90.4 110.7 $scale ([System.Drawing.Color]::FromArgb(255, 244, 248, 252)) ([System.Drawing.Color]::FromArgb(255, 231, 237, 244))
  $frontPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 196, 207, 219), [Math]::Max(0.75, 2.825 * $scale))
  Draw-RoundedLayer $graphics $scale 14.3 14.3 90.4 110.7 15.8 $frontBrush $frontPen

  # Status symbol pen (white, rounded) shared by the check and the x.
  $symbolPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(1.0, 5.876 * $scale))
  $symbolPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # Dark label pills - #2b3647
  $pillBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 54, 71))

  # Row 1: green check + pill
  $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 31, 170, 83))
  Fill-Circle $graphics $scale 41.4 48.18 18.08 $greenBrush
  Draw-ScaledLine $graphics $symbolPen $scale 31.8 48.7 38.6 55.5
  Draw-ScaledLine $graphics $symbolPen $scale 38.6 55.5 52.7 40.3
  Draw-RoundedLayer $graphics $scale 65.1 42.5 29.4 12.4 6.2 $pillBrush

  # Row 2: red x + pill
  $redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 224, 36, 36))
  Fill-Circle $graphics $scale 41.4 91.12 18.08 $redBrush
  Draw-ScaledLine $graphics $symbolPen $scale 34.6 84.3 48.2 97.9
  Draw-ScaledLine $graphics $symbolPen $scale 48.2 84.3 34.6 97.9
  Draw-RoundedLayer $graphics $scale 65.1 85.5 29.4 12.4 6.2 $pillBrush

  $path = Join-Path $OutputDir "icon-$size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $backBrush.Dispose()
  $frontBrush.Dispose()
  $frontPen.Dispose()
  $symbolPen.Dispose()
  $pillBrush.Dispose()
  $greenBrush.Dispose()
  $redBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()

  Write-Output "Created $path"
}
