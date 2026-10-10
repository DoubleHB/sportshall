# Builds the Sports Hall launcher APK with the bare Android SDK tools (no Gradle):
#   aapt2 (resources + manifest) -> javac -> d8 -> zipalign -> apksigner
# Output: android\build\SportsHall-<version>.apk
# The signing key lives in android\signing\ (gitignored). Keep it: updates must be
# signed with the same key, or the headset refuses to install them over the old one.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$bt = Join-Path $sdk 'build-tools\36.0.0'
$jar = Join-Path $sdk 'platforms\android-35\android.jar'
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Android\jdk'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

$version = ([xml](Get-Content (Join-Path $here 'AndroidManifest.xml') -Raw -Encoding UTF8)).manifest.versionName
$build = Join-Path $here 'build'
if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force "$build\classes", "$build\dex" | Out-Null

# Tools are called directly (passing them through a function's $args mangles
# "-name value" pairs), then checked here.
function Assert-Ok($step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed ($LASTEXITCODE)" }
}

# 1. Signing key (first build only)
$keyDir = Join-Path $here 'signing'
$ks = Join-Path $keyDir 'sportshall.jks'
$pwFile = Join-Path $keyDir 'password.txt'
if (-not (Test-Path $ks)) {
  New-Item -ItemType Directory -Force $keyDir | Out-Null
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  [IO.File]::WriteAllText($pwFile, $pw)
  & keytool -genkeypair -keystore $ks -alias sportshall -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $pw -keypass $pw -dname 'CN=Sports Hall, O=kramn'
  Assert-Ok 'keytool'
}
$pw = [IO.File]::ReadAllText($pwFile).Trim()

# 2. Resources and manifest
& "$bt\aapt2.exe" compile --dir (Join-Path $here 'res') -o "$build\res.zip"; Assert-Ok 'aapt2 compile'
& "$bt\aapt2.exe" link -o "$build\unsigned.apk" -I $jar --manifest (Join-Path $here 'AndroidManifest.xml') "$build\res.zip"
Assert-Ok 'aapt2 link'

# 3. Code
$java = Get-ChildItem (Join-Path $here 'src') -Recurse -Filter *.java | ForEach-Object FullName
& javac -source 8 -target 8 -bootclasspath $jar -nowarn -d "$build\classes" $java; Assert-Ok 'javac'
$classes = Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object FullName
& "$bt\d8.bat" --release --min-api 29 --lib $jar --output "$build\dex" $classes; Assert-Ok 'd8'

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open("$build\unsigned.apk", 'Update')
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$build\dex\classes.dex", 'classes.dex')
$zip.Dispose()

# 4. Align and sign
& "$bt\zipalign.exe" -f -p 4 "$build\unsigned.apk" "$build\aligned.apk"; Assert-Ok 'zipalign'
$apk = Join-Path $build "SportsHall-$version.apk"
& "$bt\apksigner.bat" sign --ks $ks --ks-key-alias sportshall --ks-pass "pass:$pw" --key-pass "pass:$pw" --out $apk "$build\aligned.apk"
Assert-Ok 'apksigner sign'
& "$bt\apksigner.bat" verify $apk; Assert-Ok 'apksigner verify'
Write-Host "Built $apk ($([math]::Round((Get-Item $apk).Length / 1KB)) KB)"
