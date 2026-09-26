$ErrorActionPreference = "Stop"

$project = $PSScriptRoot
$root = Split-Path $project -Parent
$tools = Join-Path $root ".android-toolchain"
$downloads = Join-Path $tools "downloads"
$jdk = Join-Path $tools "jdk"
$sdk = Join-Path $tools "sdk"
$gradle = Join-Path $tools "gradle-8.9"

New-Item -ItemType Directory -Force $downloads | Out-Null

if (-not (Test-Path (Join-Path $jdk "bin\java.exe"))) {
    $archive = Join-Path $downloads "jdk17.zip"
    curl.exe -fL "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" -o $archive
    $expanded = Join-Path $tools "jdk-expanded"
    New-Item -ItemType Directory -Force $expanded | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    Move-Item -LiteralPath (Get-ChildItem $expanded -Directory | Select-Object -First 1).FullName -Destination $jdk
}

if (-not (Test-Path (Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"))) {
    $archive = Join-Path $downloads "android-command-line-tools.zip"
    curl.exe -fL "https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip" -o $archive
    $actualHash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
    if ($actualHash -ne "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a") {
        throw "La descarga de Android SDK no superó la verificación SHA-256."
    }
    $expanded = Join-Path $tools "android-expanded"
    New-Item -ItemType Directory -Force $expanded | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    New-Item -ItemType Directory -Force (Join-Path $sdk "cmdline-tools") | Out-Null
    Move-Item -LiteralPath (Join-Path $expanded "cmdline-tools") -Destination (Join-Path $sdk "cmdline-tools\latest")
}

if (-not (Test-Path (Join-Path $gradle "bin\gradle.bat"))) {
    $archive = Join-Path $downloads "gradle-8.9-bin.zip"
    curl.exe -fL "https://services.gradle.org/distributions/gradle-8.9-bin.zip" -o $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $tools -Force
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$sdkManager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path (Join-Path $sdk "platforms\android-35\android.jar"))) {
    1..20 | ForEach-Object { "y" } | & $sdkManager --licenses | Out-Null
    & $sdkManager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
}

Push-Location $project
try {
    & (Join-Path $gradle "bin\gradle.bat") --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle no pudo compilar el APK." }
} finally {
    Pop-Location
}

$apk = Join-Path $project "app\build\outputs\apk\debug\app-debug.apk"
$output = Join-Path $root "DocenteTuc-1.0.3-debug.apk"
Copy-Item -LiteralPath $apk -Destination $output -Force
Write-Output $output
