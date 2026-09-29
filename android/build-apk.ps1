param([switch]$Release)

$ErrorActionPreference = "Stop"

$project = $PSScriptRoot
$root = Split-Path $project -Parent
$tools = Join-Path $root ".android-toolchain"
$downloads = Join-Path $tools "downloads"
$jdk = Join-Path $tools "jdk"
$sdk = Join-Path $tools "sdk"
$gradle = Join-Path $tools "gradle-8.13"
$gradleUser = Join-Path $tools "user-8.13"
$javaUserHome = Join-Path $tools "java-home"
$androidUserHome = Join-Path $tools "android-user"
$temporary = Join-Path $tools "temp"

New-Item -ItemType Directory -Force $downloads, $gradleUser, $javaUserHome, $androidUserHome, $temporary | Out-Null

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
    $archive = Join-Path $downloads "gradle-8.13-bin.zip"
    curl.exe -fL "https://services.gradle.org/distributions/gradle-8.13-bin.zip" -o $archive
    if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar Gradle 8.13." }
    Expand-Archive -LiteralPath $archive -DestinationPath $tools -Force
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_USER_HOME = $androidUserHome
$env:JAVA_TOOL_OPTIONS = "-Duser.home=$javaUserHome"
$env:GRADLE_USER_HOME = $gradleUser
$env:TEMP = $temporary
$env:TMP = $temporary
$sdkManager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path (Join-Path $sdk "platforms\android-36\android.jar"))) {
    1..20 | ForEach-Object { "y" } | & $sdkManager --licenses | Out-Null
    & $sdkManager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar Android SDK 36." }
}

Push-Location $project
try {
    if ($Release) {
        $signingDir = Join-Path (Split-Path $root -Parent) "DocenteTuc-signing"
        $keyPath = Join-Path $signingDir "DocenteTuc-upload.jks"
        $credentialPath = Join-Path $signingDir "signing.credential.xml"
        if (-not (Test-Path -LiteralPath $keyPath) -or -not (Test-Path -LiteralPath $credentialPath)) { throw "Falta la clave de publicación o su credencial cifrada." }
        $credential = Import-Clixml -LiteralPath $credentialPath
        $password = $credential.GetNetworkCredential().Password
        if (-not $password) { throw "La credencial de firma no se pudo descifrar con esta cuenta de Windows." }
        $env:DOCENTETUC_KEYSTORE_PATH = $keyPath
        $env:DOCENTETUC_STORE_PASSWORD = $password
        $env:DOCENTETUC_KEY_PASSWORD = $password
        & (Join-Path $gradle "bin\gradle.bat") --no-daemon assembleRelease bundleRelease
    } else {
        & (Join-Path $gradle "bin\gradle.bat") --no-daemon assembleDebug
    }
    if ($LASTEXITCODE -ne 0) { throw "Gradle no pudo compilar Android." }
} finally {
    $env:DOCENTETUC_KEYSTORE_PATH = $null
    $env:DOCENTETUC_STORE_PASSWORD = $null
    $env:DOCENTETUC_KEY_PASSWORD = $null
    $password = $null
    Pop-Location
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
if ($Release) {
    $apk = Join-Path $project "app\build\outputs\apk\release\app-release.apk"
    $aab = Join-Path $project "app\build\outputs\bundle\release\app-release.aab"
    if (-not (Test-Path -LiteralPath $apk) -or -not (Test-Path -LiteralPath $aab)) { throw "Falta el APK o el AAB de release." }
    $apkOutput = Join-Path $dist "DocenteTuc-release.apk"
    $aabOutput = Join-Path $dist "DocenteTuc-release.aab"
    Copy-Item -LiteralPath $apk -Destination $apkOutput -Force
    Copy-Item -LiteralPath $aab -Destination $aabOutput -Force
    Write-Output $apkOutput, $aabOutput
} else {
    $apk = Join-Path $project "app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Falta el APK de prueba." }
    $output = Join-Path $dist "DocenteTuc-debug.apk"
    Copy-Item -LiteralPath $apk -Destination $output -Force
    Write-Output $output
}
