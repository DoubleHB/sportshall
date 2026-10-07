# Syntax-checks every source file, then runs the headless engine tests, with the
# portable Node in C:\Claude\tools\node.
$node = Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'tools\node\node.exe'
$src = Join-Path (Split-Path $PSScriptRoot) 'src'
$bad = 0
foreach ($f in Get-ChildItem $src -Filter *.js) {
  $out = & $node --check $f.FullName 2>&1
  if ($LASTEXITCODE) { Write-Host "SYNTAX ERROR in $($f.Name):"; $out | Select-Object -First 6 | ForEach-Object { Write-Host "  $_" }; $bad++ }
}
if ($bad) { exit 1 }
& $node --test --test-reporter=spec (Join-Path $PSScriptRoot 'engine.test.mjs')
exit $LASTEXITCODE
