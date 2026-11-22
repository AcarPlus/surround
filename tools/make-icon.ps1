# Surround uygulama simgesini (src/Surround.App/Assets/surround.ico) üretir.
# "Pusula": koyu lacivert yuvarlak kare üzerinde, dinleyicinin (merkez nokta) çevresinde ışınsal çubuklar;
# çubuklar 5.1 hoparlör yönlerinde (ön orta, ön sol/sağ, arka sol/sağ) uzar — uygulamadaki ses pusulası.
# Büyük boylarda 24 çubuk, <= 32 px'te 12 çubuk (16 px'te de seçilsin diye). ui/src/components/SurroundMark.tsx ve
# site/index.html aynı geometriyi kullanır.
# Kullanım: powershell -File tools/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'src/Surround.App/Assets'
New-Item -ItemType Directory -Force $outDir | Out-Null
$sizes = 16, 24, 32, 48, 64, 128, 256
# hoparlör yönleri (ekran açısı, -90 = yukarı): C, R, L, SR, SL
$speakers = -90, -60, -120, 20, 160

function New-Frame([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    # arka plan: yuvarlatılmış koyu lacivert kare
    $r = $s * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($s - $d, 0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc(0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 19, 48))), $path)

    $c = $s / 2.0
    if ($s -ge 48) {
        # 256 px tasarımı: 24 çubuk, iç yarıçap 48, taban 12, genlik 44, sigma 14
        $u = $s / 256.0; $n = 24; $r0 = 48 * $u; $base = 12 * $u; $amp = 44 * $u; $sig = 14; $cap = $false
        $w = 10 * $u; $dot = 20 * $u
    } else {
        # 64 px tasarımı: 12 çubuk, iç yarıçap 12, taban 3, genlik 12, sigma 20, tavanlı
        $u = $s / 64.0; $n = 12; $r0 = 12 * $u; $base = 3 * $u; $amp = 12 * $u; $sig = 20; $cap = $true
        $w = [Math]::Max(1.4, 6 * $u); $dot = [Math]::Max(1.6, 5 * $u)
    }
    for ($i = 0; $i -lt $n; $i++) {
        $a = $i * 360.0 / $n - 90
        $sum = 0.0
        foreach ($b in $speakers) {
            $dd = [Math]::Abs(((($a - $b + 540) % 360) - 180))
            $sum += [Math]::Exp(-($dd * $dd) / (2 * $sig * $sig))
        }
        if ($cap) { $sum = [Math]::Min(1.0, $sum) }
        $len = $base + $amp * $sum
        $k = [Math]::Min(1.0, $sum)
        $col = if ($k -gt 0.5) { [System.Drawing.Color]::FromArgb(185, 166, 255) } else { [System.Drawing.Color]::FromArgb(142, 162, 255) }
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb([int](255 * (0.45 + 0.55 * $k)), $col)), $w
        $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
        $t = $a * [Math]::PI / 180
        $g.DrawLine($pen, [single]($c + $r0 * [Math]::Cos($t)), [single]($c + $r0 * [Math]::Sin($t)),
            [single]($c + ($r0 + $len) * [Math]::Cos($t)), [single]($c + ($r0 + $len) * [Math]::Sin($t)))
        $pen.Dispose()
    }
    # dinleyici
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 238, 241, 255))), $c - $dot, $c - $dot, 2 * $dot, 2 * $dot)
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
