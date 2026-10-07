# Runs the headless engine tests with the portable Node in C:\Claude\tools\node.
$node = Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'tools\node\node.exe'
& $node --test --test-reporter=spec (Join-Path $PSScriptRoot 'engine.test.mjs')
exit $LASTEXITCODE
