param(
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$MaxWidth = 360,
    [int]$Quality = 70
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$src = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($src)
$g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $src.Size)
$g.Dispose()

$srcW = $src.Width
$srcH = $src.Height
if ($MaxWidth -gt 0 -and $srcW -gt $MaxWidth) {
    $nw = $MaxWidth
    $nh = [int][Math]::Round($srcH * ($MaxWidth / [double]$srcW))
    $dst = New-Object System.Drawing.Bitmap $nw, $nh
    $g2 = [System.Drawing.Graphics]::FromImage($dst)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($src, 0, 0, $nw, $nh)
    $g2.Dispose()
    $src.Dispose()
    $src = $dst
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$src.Save($Out, $codec, $ep)
$meta = @{
    width     = $src.Width
    height    = $src.Height
    srcWidth  = $srcW
    srcHeight = $srcH
} | ConvertTo-Json -Compress
$src.Dispose()
Write-Output $meta
