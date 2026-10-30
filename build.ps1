# Surround: arayüzü derler, testleri çalıştırır, uygulamayı yayımlar ve Velopack ile kurulum paketi üretir.
# Çıktı: artifacts/releases/Surround-win-Setup.exe
# Kullanım: powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipTests] [-Version 0.1.0]
param(
    [switch]$SkipTests,
    [string]$Version
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run([scriptblock]$cmd) {
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "Komut başarısız (çıkış kodu $LASTEXITCODE): $cmd" }
}

$csproj = 'src/Surround.App/Surround.App.csproj'
if (-not $Version) {
    $Version = ([xml](Get-Content $csproj -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
}
if (-not $Version) { throw "Sürüm $csproj içindeki <Version> öğesinden okunamadı." }
Write-Host "Surround sürüm $Version"

Step 'Arayüz (ui)'
if (-not (Test-Path 'ui/node_modules')) { Run { npm --prefix ui ci } }
Run { npm --prefix ui run build }

if (-not $SkipTests) {
    Step 'Testler'
    Run { dotnet test Surround.sln -c Release }
}

Step 'Yayımlama (win-x64, self-contained)'
if (Test-Path 'artifacts/publish') { Remove-Item 'artifacts/publish' -Recurse -Force }
Run { dotnet publish src/Surround.App -c Release -r win-x64 --self-contained -p:Version=$Version -o artifacts/publish }

Step 'Velopack paketi'
# Aynı sürüm tekrar paketlenemez; güncelleme akışı kurulana kadar eski çıktıları temizliyoruz.
if (Test-Path 'artifacts/releases') { Remove-Item 'artifacts/releases' -Recurse -Force }
Run { dotnet tool restore }
Run {
    dotnet vpk pack `
        --packId Surround `
        --packVersion $Version `
        --packDir artifacts/publish `
        --mainExe Surround.exe `
        --packTitle Surround `
        --runtime win-x64 `
        --icon src/Surround.App/Assets/surround.ico `
        --framework webview2 `
        -o artifacts/releases
}

$setup = Get-ChildItem 'artifacts/releases' -Filter '*Setup.exe' | Select-Object -First 1
if (-not $setup) { throw 'Kurulum dosyası (Setup.exe) üretilemedi.' }
Write-Host ("`nHazır: {0} ({1:N1} MB)" -f $setup.FullName, ($setup.Length / 1MB)) -ForegroundColor Green
