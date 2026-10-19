Add-Type -AssemblyName System.Drawing

$inPath = Join-Path (Get-Location) "public\logo.jpg"
$outPng = Join-Path (Get-Location) "public\logo.png"
$outEmailPng = Join-Path (Get-Location) "public\logo-email.png"

$orig = [System.Drawing.Bitmap]::FromFile($inPath)

# 1. Save lossless full-size PNG
$orig.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)

# 2. Create high-DPI 256x256 email-optimized version with circular crop and anti-aliasing
$targetSize = 256
$emailBmp = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx = [System.Drawing.Graphics]::FromImage($emailBmp)
$gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Clear with white background for solid badge fill
$gfx.Clear([System.Drawing.Color]::White)

# Draw image scaled to fit
$gfx.DrawImage($orig, 0, 0, $targetSize, $targetSize)
$gfx.Dispose()

# Save email png
$emailBmp.Save($outEmailPng, [System.Drawing.Imaging.ImageFormat]::Png)
$emailBmp.Dispose()
$orig.Dispose()

Write-Host "Generated public\logo.png and public\logo-email.png successfully"
