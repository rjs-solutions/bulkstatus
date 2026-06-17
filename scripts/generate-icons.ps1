param(
  [string]$OutputDir = "$PSScriptRoot\..\extension\assets\icons"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 128)

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

function New-ScaledRect {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Scale
  )

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
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius,
    [float]$Scale
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $path (New-ScaledRect $X $Y $Width $Height $Scale) ($Radius * $Scale)
  return $path
}

function New-GradientBrush {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Scale,
    [System.Drawing.Color]$StartColor,
    [System.Drawing.Color]$EndColor
  )

  $rect = New-ScaledRect $X $Y $Width $Height $Scale
  return [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $StartColor, $EndColor, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
}

function Draw-RoundedLayer {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$Scale,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius,
    [System.Drawing.Brush]$Brush,
    [System.Drawing.Pen]$Pen = $null
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
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Pen]$Pen,
    [float]$Scale,
    [float]$X1,
    [float]$Y1,
    [float]$X2,
    [float]$Y2
  )

  $Graphics.DrawLine($Pen, $X1 * $Scale, $Y1 * $Scale, $X2 * $Scale, $Y2 * $Scale)
}

function Draw-StatusDot {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$Scale,
    [float]$CenterX,
    [float]$CenterY,
    [float]$Radius,
    [System.Drawing.Brush]$Fill,
    [System.Drawing.Pen]$Stroke,
    [string]$Symbol
  )

  $ellipse = New-ScaledRect ($CenterX - $Radius) ($CenterY - $Radius) ($Radius * 2) ($Radius * 2) $Scale
  $Graphics.FillEllipse($Fill, $ellipse)
  $Graphics.DrawEllipse($Stroke, $ellipse)

  $glossBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(95, 255, 255, 255))
  $gloss = New-ScaledRect ($CenterX - 7.5) ($CenterY - 7.5) 15 7 $Scale
  $Graphics.FillEllipse($glossBrush, $gloss)
  $glossBrush.Dispose()

  if ($Scale -lt 0.18) {
    return
  }

  $symbolPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(1.15, 3 * $Scale))
  $symbolPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $symbolPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  if ($Symbol -eq "check") {
    Draw-ScaledLine $Graphics $symbolPen $Scale ($CenterX - 4.6) ($CenterY + .2) ($CenterX - 1.4) ($CenterY + 3.7)
    Draw-ScaledLine $Graphics $symbolPen $Scale ($CenterX - 1.4) ($CenterY + 3.7) ($CenterX + 5.2) ($CenterY - 3.5)
  }
  elseif ($Symbol -eq "alert") {
    Draw-ScaledLine $Graphics $symbolPen $Scale $CenterX ($CenterY - 6.1) $CenterX ($CenterY + 1.6)
    $dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $Graphics.FillEllipse($dotBrush, (New-ScaledRect ($CenterX - 1.7) ($CenterY + 4.3) 3.4 3.4 $Scale))
    $dotBrush.Dispose()
  }
  elseif ($Symbol -eq "x") {
    Draw-ScaledLine $Graphics $symbolPen $Scale ($CenterX - 4) ($CenterY - 4) ($CenterX + 4) ($CenterY + 4)
    Draw-ScaledLine $Graphics $symbolPen $Scale ($CenterX + 4) ($CenterY - 4) ($CenterX - 4) ($CenterY + 4)
  }

  $symbolPen.Dispose()
}

foreach ($size in $sizes) {
  $scale = $size / 128
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 15, 23, 42))
  Draw-RoundedLayer $graphics $scale 8 16 118 110 21 $shadowBrush

  $backBrush = New-GradientBrush 14 18 112 106 $scale ([System.Drawing.Color]::FromArgb(255, 97, 116, 134)) ([System.Drawing.Color]::FromArgb(255, 23, 35, 51))
  $backPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 16, 24, 39), [Math]::Max(.7, 1.5 * $scale))
  Draw-RoundedLayer $graphics $scale 14 18 112 106 20 $backBrush $backPen

  $innerDarkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(58, 16, 24, 39))
  Draw-RoundedLayer $graphics $scale 24 28 92 86 14 $innerDarkBrush

  $midBrush = New-GradientBrush 8 12 112 106 $scale ([System.Drawing.Color]::FromArgb(255, 215, 225, 235)) ([System.Drawing.Color]::FromArgb(255, 65, 83, 105))
  $midPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 113, 132, 153), [Math]::Max(.7, 1.35 * $scale))
  Draw-RoundedLayer $graphics $scale 8 12 112 106 20 $midBrush $midPen

  $innerBlueBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(43, 16, 32, 51))
  Draw-RoundedLayer $graphics $scale 18 22 92 86 14 $innerBlueBrush

  $frontBrush = New-GradientBrush 2 6 112 106 $scale ([System.Drawing.Color]::White) ([System.Drawing.Color]::FromArgb(255, 238, 243, 248))
  $frontPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 200, 211, 223), [Math]::Max(.75, 1.7 * $scale))
  Draw-RoundedLayer $graphics $scale 2 6 112 106 20 $frontBrush $frontPen

  $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 34, 197, 94))
  $greenPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 18, 131, 61), [Math]::Max(.75, 1.45 * $scale))
  $amberBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
  $amberPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 189, 111, 7), [Math]::Max(.75, 1.45 * $scale))
  $redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 239, 68, 68))
  $redPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 185, 28, 28), [Math]::Max(.75, 1.45 * $scale))

  Draw-StatusDot $graphics $scale 22 28 11.4 $greenBrush $greenPen "check"
  Draw-StatusDot $graphics $scale 22 61 11.4 $amberBrush $amberPen "alert"
  Draw-StatusDot $graphics $scale 22 94 11.4 $redBrush $redPen "x"

  $barBrush = New-GradientBrush 42 20.7 67 14.8 $scale ([System.Drawing.Color]::FromArgb(255, 39, 50, 68)) ([System.Drawing.Color]::FromArgb(255, 23, 33, 49))
  foreach ($y in @(20.7, 53.7, 86.7)) {
    Draw-RoundedLayer $graphics $scale 42 $y 67 14.8 7.4 $barBrush
  }

  $path = Join-Path $OutputDir "icon-$size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $shadowBrush.Dispose()
  $backBrush.Dispose()
  $backPen.Dispose()
  $innerDarkBrush.Dispose()
  $midBrush.Dispose()
  $midPen.Dispose()
  $innerBlueBrush.Dispose()
  $frontBrush.Dispose()
  $frontPen.Dispose()
  $greenBrush.Dispose()
  $greenPen.Dispose()
  $amberBrush.Dispose()
  $amberPen.Dispose()
  $redBrush.Dispose()
  $redPen.Dispose()
  $barBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
