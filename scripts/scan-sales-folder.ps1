# Scan the Monza sales folder and print a manifest as JSON.
#
# A PowerShell twin of scripts/import-sales-folder.mjs, for the common case
# where the folder lives on a machine that does not have this repository
# checked out. It reads the folder, changes nothing, and prints JSON to paste
# back - the same shape import-sales-folder.mjs writes.
#
# USAGE (from any directory):
#   powershell -File scan-sales-folder.ps1 -Root "C:\Users\jawad\Downloads\Monza AI sales"
#
# Expected shape, which is how the folder actually is:
#   Monza AI sales\Car Models\<Model>\Catalog\<one PDF>
#   Monza AI sales\Car Models\<Model>\Videos\<Colour>\<video files>
#
# Two real cases are handled deliberately:
#   - an EMPTY colour folder (Mhero 1\Videos\Black) is recorded and marked
#     unsendable, so the gap shows on the dashboard instead of vanishing;
#   - videos sitting directly under Videos\ with no colour folder at all
#     (Voyah Dream) become one option with no colour choice, rather than
#     having colours invented for them.

param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$ErrorActionPreference = "Stop"

$VideoExt = @(".mp4", ".mov", ".m4v", ".webm", ".mkv")
$MaxBytes = 50MB

if (-not (Test-Path -LiteralPath $Root)) {
  Write-Error "That folder does not exist:`n  $Root"
  exit 1
}

# Find "Car Models" wherever it sits. Real folders arrive nested - unzipping
# produced "Monza AI sales\Monza AI sales\Car Models". Checking only the top
# level found nothing, fell back to treating $Root as the model list, and
# produced one "car" named after the inner folder.
$base = $null
if (Test-Path -LiteralPath (Join-Path $Root "Car Models")) {
  $base = Join-Path $Root "Car Models"
} else {
  $found = Get-ChildItem -LiteralPath $Root -Directory -Recurse -Depth 4 -Filter "Car Models" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $base = $found.FullName }
}
if (-not $base) { $base = $Root }
Write-Host "Reading: $base"

function Get-Slug([string]$name) {
  $s = $name.ToLower() -replace '[^a-z0-9]+', '-'
  return $s.Trim('-')
}

# Words that must never become a bare alias - they appear in ordinary
# sentences. "free" genuinely misfired once on "feel free to call me".
$Common = @("free", "comp", "competition", "one", "two")

function Get-Aliases([string]$name) {
  $out = [System.Collections.Generic.HashSet[string]]::new()
  $lower = $name.ToLower().Trim()
  [void]$out.Add($lower)

  $noBrand = ($lower -replace '^(voyah|mhero|m-hero|m hero)\s+', '').Trim()
  if ($noBrand -and $noBrand -ne $lower -and ($Common -notcontains $noBrand)) {
    [void]$out.Add($noBrand)
  }
  if ($lower -match '^mhero') {
    [void]$out.Add(($lower -replace '^mhero', 'm hero'))
    [void]$out.Add(($lower -replace '^mhero', 'm-hero'))
    if ($lower -match '\b1\b') { [void]$out.Add(($lower -replace '\b1\b', 'i')) }
    if ($lower -match '\b2\b') { [void]$out.Add(($lower -replace '\b2\b', 'ii')) }
  }
  return @($out | Where-Object { $_.Length -ge 3 })
}

function Get-MediaFiles([string]$dir, [string[]]$extensions) {
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith(".") -and $extensions -contains $_.Extension.ToLower() } |
    Sort-Object Name |
    ForEach-Object { [ordered]@{ fileName = $_.Name; bytes = $_.Length } }
}

$cars = @()
$warnings = @()

foreach ($modelDir in (Get-ChildItem -LiteralPath $base -Directory | Sort-Object Name)) {
  $model = $modelDir.Name
  $catalogDir = Join-Path $modelDir.FullName "Catalog"
  $videosDir = Join-Path $modelDir.FullName "Videos"

  # One catalogue per car, whatever colour the customer picks.
  $pdfs = @(Get-MediaFiles $catalogDir @(".pdf"))
  if ($pdfs.Count -eq 0) {
    $warnings += "$model : no catalogue PDF - it can never auto-send."
  } elseif ($pdfs.Count -gt 1) {
    $warnings += "$model : $($pdfs.Count) PDFs in Catalog; using '$($pdfs[0].fileName)'."
  }
  $brochure = if ($pdfs.Count -gt 0) { $pdfs[0] } else { $null }
  # A catalogue can be over the cap too - the real Voyah Passion PDF is 68 MB.
  if ($brochure -and $brochure.bytes -gt $MaxBytes) {
    $mb = [math]::Round($brochure.bytes / 1MB, 1)
    $warnings += "$model / $($brochure.fileName) : $mb MB is over the 50 MB limit - compress before uploading."
  }

  $colours = @()
  $colourDirs = @()
  if (Test-Path -LiteralPath $videosDir) {
    $colourDirs = @(Get-ChildItem -LiteralPath $videosDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
  }
  $loose = @(Get-MediaFiles $videosDir $VideoExt)

  if ($colourDirs.Count -eq 0 -and $loose.Count -gt 0) {
    $colours += [ordered]@{
      id = "standard"; name = "Standard"; aliases = @();
      videos = $loose; noColourChoice = $true
    }
    $warnings += "$model : videos are not in colour folders - treated as one option with no colour choice."
  } elseif ($loose.Count -gt 0) {
    $warnings += "$model : $($loose.Count) video(s) sit outside a colour folder and were skipped."
  }

  foreach ($colourDir in $colourDirs) {
    $videos = @(Get-MediaFiles $colourDir.FullName $VideoExt)
    if ($videos.Count -eq 0) {
      $warnings += "$model / $($colourDir.Name) : folder is empty - cannot be offered."
    }
    foreach ($v in $videos) {
      if ($v.bytes -gt $MaxBytes) {
        $mb = [math]::Round($v.bytes / 1MB, 1)
        $warnings += "$model / $($colourDir.Name) / $($v.fileName) : $mb MB is over the 50 MB limit - compress before uploading."
      }
    }
    $colours += [ordered]@{
      id = (Get-Slug $colourDir.Name); name = $colourDir.Name;
      aliases = @($colourDir.Name.ToLower()); videos = $videos
    }
  }

  $sendable = @($colours | Where-Object { $_.videos.Count -gt 0 })
  $cars += [ordered]@{
    id          = (Get-Slug $model)
    name        = $model
    folder      = $model
    aliases     = @(Get-Aliases $model)
    brochure    = $brochure
    colours     = $colours
    readyToSend = ($null -ne $brochure -and $sendable.Count -gt 0)
  }
}

$manifest = [ordered]@{
  importedFrom = (Split-Path -Leaf $Root)
  cars         = $cars
  warnings     = $warnings
}

# A readable summary first, so a person can sanity-check it before pasting.
Write-Host ""
Write-Host "===== SUMMARY (read this) ====="
foreach ($car in $cars) {
  $flag = if ($car.readyToSend) { "READY" } else { "NOT READY" }
  Write-Host ""
  Write-Host "$($car.name)  [$flag]"
  $cat = if ($car.brochure) { $car.brochure.fileName } else { "MISSING" }
  Write-Host "  catalogue: $cat"
  foreach ($c in $car.colours) {
    $state = if ($c.videos.Count -eq 0) { "EMPTY - will not be offered" } else { "$($c.videos.Count) video(s)" }
    Write-Host ("  {0,-12} {1}" -f $c.name, $state)
  }
}
if ($warnings.Count -gt 0) {
  Write-Host ""
  Write-Host "NEEDS YOUR ATTENTION"
  foreach ($w in $warnings) { Write-Host "  - $w" }
}

Write-Host ""
Write-Host "===== COPY EVERYTHING BELOW THIS LINE ====="
$manifest | ConvertTo-Json -Depth 10 -Compress
