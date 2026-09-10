[CmdletBinding()]
param(
  [switch]$NoReport
)

$ErrorActionPreference = 'Stop'
$cloudRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$buildRoot = Join-Path $cloudRoot 'build'
$artifactsRoot = Join-Path $cloudRoot 'artifacts'
$policyPath = Join-Path $cloudRoot 'source-policy.json'
$policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
$functionNames = @($policy.functions | ForEach-Object { [string]$_.name })
$prunePolicy = $policy.dependencyPrunePolicy
$artifactLimits = $policy.artifactLimits
$zipMaxBytesExclusive = [int64]$artifactLimits.zipMaxBytesExclusive
$codeAndLayersMaxBytesInclusive = [int64]$artifactLimits.codeAndLayersMaxBytesInclusive
$candidateLayerBytes = [int64]$artifactLimits.candidateLayerBytes
$developmentDirectories = @($prunePolicy.developmentOnlyDirectorySegments | ForEach-Object { ([string]$_).ToLowerInvariant() })
$developmentFilenameTokens = @($prunePolicy.developmentOnlyFilenameTokens | ForEach-Object { ([string]$_).ToLowerInvariant() })
$documentationBasenames = @($prunePolicy.documentationBasenames | ForEach-Object { ([string]$_).ToLowerInvariant() })
$firstPartyMediaExtensions = @($prunePolicy.firstPartyLocalMediaExtensions | ForEach-Object { ([string]$_).ToLowerInvariant() })
$requiredEntries = @('index.js', 'cloud-runtime.js', 'package.json', 'package-lock.json', 'NOVA_PACKAGE_MANIFEST.json')

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-NormalizedRelativePath {
  param([string]$Root, [string]$Path)
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside expected root: $Path"
  }
  return $pathFull.Substring($rootFull.Length + 1).Replace('\', '/')
}

function Get-EntryPolicyViolations {
  param([string]$EntryName)
  $violations = @()
  $normalized = $EntryName.Replace('\', '/')
  if ($normalized.StartsWith('./')) { $normalized = $normalized.Substring(2) }
  $lower = $normalized.ToLowerInvariant()
  $segments = @($lower.Split('/') | Where-Object { $_ -ne '' })
  $basename = if ($segments.Count) { $segments[-1] } else { '' }
  $directorySegments = if ($segments.Count -gt 1) { @($segments[0..($segments.Count - 2)]) } else { @() }

  if ([string]::IsNullOrWhiteSpace($normalized) -or
      $EntryName.StartsWith('/') -or
      $EntryName.StartsWith('\') -or
      $EntryName -match '^[A-Za-z]:[\\/]' -or
      $segments -contains '..') {
    $violations += 'unsafe-or-absolute-entry-path'
  }
  if ($segments | Where-Object { $_ -eq '.env' -or $_.StartsWith('.env.') }) {
    $violations += 'environment-file'
  }
  if ($lower.EndsWith('.map')) { $violations += 'source-map' }
  if ($lower -match '\.d\.(?:ts|mts|cts)$') { $violations += 'type-declaration' }
  if ($developmentDirectories | Where-Object { $directorySegments -contains $_ }) {
    $violations += 'development-directory'
  }
  $filenameParts = @($basename.Split(@('.', '_', '-'), [System.StringSplitOptions]::RemoveEmptyEntries))
  if ($developmentFilenameTokens | Where-Object { $filenameParts -contains $_ }) {
    $violations += 'development-filename'
  }
  foreach ($token in $documentationBasenames) {
    if ($basename -eq $token -or $basename.StartsWith($token + '.')) {
      $violations += 'dependency-documentation'
      break
    }
  }
  if (-not $lower.StartsWith('node_modules/')) {
    $extension = [System.IO.Path]::GetExtension($lower)
    if ($firstPartyMediaExtensions -contains $extension) {
      $violations += 'first-party-local-media'
    }
  }
  return @($violations | Select-Object -Unique)
}

function Get-ZipEntrySha256 {
  param([System.IO.Compression.ZipArchiveEntry]$Entry)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = $Entry.Open()
  try {
    $bytes = $sha.ComputeHash($stream)
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

$packageResults = @()
$allViolations = @()
foreach ($functionName in $functionNames) {
  $stagingDir = Join-Path $buildRoot $functionName
  $zipPath = Join-Path $artifactsRoot "$functionName.zip"
  if (-not (Test-Path -LiteralPath $stagingDir -PathType Container)) {
    throw "Missing staging directory: $stagingDir"
  }
  if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
    throw "Missing ZIP: $zipPath"
  }

  $expectedNames = @(
    Get-ChildItem -LiteralPath $stagingDir -File -Recurse -Force |
      ForEach-Object { Get-NormalizedRelativePath -Root $stagingDir -Path $_.FullName } |
      Sort-Object
  )
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $fileEntries = @($archive.Entries | Where-Object { -not [string]::IsNullOrEmpty($_.Name) })
    $zipBytes = [int64](Get-Item -LiteralPath $zipPath).Length
    $uncompressedCodeBytes = [int64](($fileEntries | Measure-Object -Property Length -Sum).Sum)
    $codeAndLayersBytes = $uncompressedCodeBytes + $candidateLayerBytes
    $actualNames = @($fileEntries | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
    $duplicates = @($actualNames | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })
    $pathDiff = @(Compare-Object -ReferenceObject $expectedNames -DifferenceObject $actualNames |
      ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" })
    $missingRequired = @($requiredEntries | Where-Object { $actualNames -notcontains $_ })
    $pathViolations = @()
    foreach ($entry in $fileEntries) {
      foreach ($reason in (Get-EntryPolicyViolations -EntryName $entry.FullName)) {
        $pathViolations += "$($entry.FullName.Replace('\', '/')): $reason"
      }
    }

    $manifestEntry = $fileEntries | Where-Object { $_.FullName.Replace('\', '/') -eq 'NOVA_PACKAGE_MANIFEST.json' } | Select-Object -First 1
    $manifestIssues = @()
    $contentPolicy = $null
    if ($null -eq $manifestEntry) {
      $manifestIssues += 'missing NOVA_PACKAGE_MANIFEST.json'
    } else {
      $reader = [System.IO.StreamReader]::new($manifestEntry.Open(), [System.Text.Encoding]::UTF8, $true)
      try {
        $manifest = $reader.ReadToEnd() | ConvertFrom-Json
      } finally {
        $reader.Dispose()
      }
      $contentPolicy = $manifest.contentPolicy
      if ([string]$manifest.functionType -ne 'Event') {
        $manifestIssues += 'manifest functionType is not Event'
      }
      if ([string]$manifest.handler -ne 'index.main_handler') {
        $manifestIssues += 'manifest handler is not index.main_handler'
      }
      if ([int64]$manifest.limits.zipMaxBytesExclusive -ne $zipMaxBytesExclusive -or
          [int64]$manifest.limits.codeAndLayersMaxBytesInclusive -ne $codeAndLayersMaxBytesInclusive -or
          [int64]$manifest.limits.candidateLayerBytes -ne $candidateLayerBytes) {
        $manifestIssues += 'manifest artifact/layer limits do not match source policy'
      }
      if ($null -eq $contentPolicy) {
        $manifestIssues += 'missing manifest contentPolicy proof'
      } else {
        foreach ($field in @('deployablePathViolations', 'suspectedSecretFindings', 'localAbsolutePathFindings')) {
          if ([int]$contentPolicy.$field -ne 0) {
            $manifestIssues += "manifest contentPolicy $field is not zero"
          }
        }
      }
      $manifestFiles = @($manifest.files)
      $manifestNames = @($manifestFiles | ForEach-Object { [string]$_.path } | Sort-Object)
      $archivePayloadNames = @($actualNames | Where-Object { $_ -ne 'NOVA_PACKAGE_MANIFEST.json' } | Sort-Object)
      $manifestIssues += @(Compare-Object -ReferenceObject $manifestNames -DifferenceObject $archivePayloadNames |
        ForEach-Object { "manifest path $($_.SideIndicator) $($_.InputObject)" })
      foreach ($manifestFile in $manifestFiles) {
        $entryName = [string]$manifestFile.path
        $zipEntry = $fileEntries | Where-Object { $_.FullName.Replace('\', '/') -eq $entryName } | Select-Object -First 1
        if ($null -eq $zipEntry) { continue }
        if ([int64]$manifestFile.bytes -ne [int64]$zipEntry.Length) {
          $manifestIssues += "$entryName byte count mismatch"
          continue
        }
        $entryHash = Get-ZipEntrySha256 -Entry $zipEntry
        if ($entryHash -ne ([string]$manifestFile.sha256).ToLowerInvariant()) {
          $manifestIssues += "$entryName sha256 mismatch"
        }
      }
    }

    $violations = @(
      if ($zipBytes -ge $zipMaxBytesExclusive) { "ZIP bytes $zipBytes must be < $zipMaxBytesExclusive" }
      if ($codeAndLayersBytes -gt $codeAndLayersMaxBytesInclusive) { "uncompressed code + layers bytes $codeAndLayersBytes must be <= $codeAndLayersMaxBytesInclusive" }
      $duplicates | ForEach-Object { "duplicate entry: $_" }
      $pathDiff | ForEach-Object { "ZIP/staging path mismatch: $_" }
      $missingRequired | ForEach-Object { "missing required root entry: $_" }
      $pathViolations
      $manifestIssues
    )
    foreach ($violation in $violations) {
      $allViolations += "${functionName}: $violation"
    }
    $packageResults += [pscustomobject]@{
      function = $functionName
      zip = [System.IO.Path]::GetFileName($zipPath)
      zipBytes = $zipBytes
      zipMaxBytesExclusive = $zipMaxBytesExclusive
      uncompressedCodeBytes = $uncompressedCodeBytes
      candidateLayerBytes = $candidateLayerBytes
      codeAndLayersBytes = $codeAndLayersBytes
      codeAndLayersMaxBytesInclusive = $codeAndLayersMaxBytesInclusive
      layerInventory = [string]$artifactLimits.candidateLayerInventory
      entries = $actualNames.Count
      sourceMaps = @($pathViolations | Where-Object { $_ -like '*: source-map' }).Count
      developmentArtifacts = @($pathViolations | Where-Object { $_ -match ': (?:development-directory|development-filename)$' }).Count
      typeDeclarations = @($pathViolations | Where-Object { $_ -like '*: type-declaration' }).Count
      dependencyDocumentation = @($pathViolations | Where-Object { $_ -like '*: dependency-documentation' }).Count
      envFiles = @($pathViolations | Where-Object { $_ -like '*: environment-file' }).Count
      firstPartyLocalMedia = @($pathViolations | Where-Object { $_ -like '*: first-party-local-media' }).Count
      suspectedSecrets = if ($null -eq $contentPolicy) { -1 } else { [int]$contentPolicy.suspectedSecretFindings }
      localAbsolutePaths = if ($null -eq $contentPolicy) { -1 } else { [int]$contentPolicy.localAbsolutePathFindings }
      zipMatchesStaging = $pathDiff.Count -eq 0
      manifestPathsAndHashesMatch = $manifestIssues.Count -eq 0
      ok = $violations.Count -eq 0
    }
  } finally {
    $archive.Dispose()
  }
}

$result = [ordered]@{
  schemaVersion = 'nova.scf-package-policy/v1'
  checkedAt = [DateTimeOffset]::Now.ToString('o')
  claim = 'LOCAL_ZIP_POLICY_AND_MANIFEST_VERIFICATION_ONLY_NOT_CLOUD_ACCEPTANCE'
  ok = $allViolations.Count -eq 0
  packages = $packageResults
  violations = $allViolations
}
$json = $result | ConvertTo-Json -Depth 8
if (-not $NoReport) {
  New-Item -ItemType Directory -Force -Path $artifactsRoot | Out-Null
  [System.IO.File]::WriteAllText(
    (Join-Path $artifactsRoot 'PACKAGE_POLICY_REPORT.json'),
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
}
Write-Output $json
if (-not $result.ok) {
  throw "Cloud candidate ZIP policy failed with $($allViolations.Count) violation(s)."
}
