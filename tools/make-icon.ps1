# Surround uygulama simgesini (src/Surround.App/Assets/surround.ico) üretir.
# Koyu yuvarlak kare + merkezde nokta ve ona doğru açılan eş merkezli yaylar (hoparlör/dalga).
# Kullanım: powershell -File tools/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'src/Surround.App/Assets'
New-Item -ItemType Directory -Force $outDir | Out-Null
$sizes = 16, 24, 32, 48, 64, 128, 256

function New-Frame([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    # arka plan: yuvarlatılmış kare
    $r = $s * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($s - $d, 0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc(0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 21, 22, 25))), $path)

    $accent = [System.Drawing.Color]::FromArgb(255, 212, 242, 90)
    $cx = $s * 0.36; $cy = $s * 0.5
    # kaynak noktası
    $dot = $s * 0.075
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $accent), $cx - $dot, $cy - $dot, 2 * $dot, 2 * $dot)
    # yaylar (sağa doğru yayılan)
    $w = [Math]::Max(1.2, $s * 0.062)
    foreach ($i in 1..3) {
        $rad = $s * (0.17 * $i + 0.02)
        $alpha = [int](255 - ($i - 1) * 55)
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alpha, $accent)), $w
        $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
        $g.DrawArc($pen, $cx - $rad, $cy - $rad, 2 * $rad, 2 * $rad, -48, 96)
    }
    $g.Dispose()
    return $bmp
}

$frames = foreach ($s in $sizes) {
    $bmp = New-Frame $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    , $ms.ToArray()
}

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$frames[$i].Length); $bw.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $bw.Write($f) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'surround.ico'), $out.ToArray())
Write-Host "Yazıldı: $(Join-Path $outDir 'surround.ico')"
