# Draws the launcher icon (the favicon's paddle and ball on the game's dark blue)
# into res\mipmap-*\ic_launcher.png. Run once; the PNGs are committed.
Add-Type -AssemblyName System.Drawing
$sizes = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
foreach ($dir in $sizes.Keys) {
  $n = $sizes[$dir]
  $bmp = New-Object System.Drawing.Bitmap $n, $n
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  # Rounded square background
  $r = $n * 0.22; $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $path.AddArc($n - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($n - 2 * $r, $n - 2 * $r, 2 * $r, 2 * $r, 0, 90); $path.AddArc(0, $n - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#0e1320'))), $path)
  # The favicon is drawn in a 64-unit box; inset it a little
  $s = $n / 64 * 0.8; $o = $n * 0.1
  $g.TranslateTransform($o, $o); $g.ScaleTransform($s, $s)
  # Handle: rect x34 y38 w10 h24 rotated -45 degrees about (39, 50)
  $st = $g.Save()
  $g.TranslateTransform(39, 50); $g.RotateTransform(-45); $g.TranslateTransform(-39, -50)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c89a62'))), 34, 38, 10, 24)
  $g.Restore($st)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#d8262f'))), 6, 6, 40, 40)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#ff9a2e'))), 43, 7, 14, 14)
  $g.Dispose()
  $out = Join-Path $PSScriptRoot "res\$dir"
  New-Item -ItemType Directory -Force $out | Out-Null
  $bmp.Save((Join-Path $out 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Host 'Icons written.'
