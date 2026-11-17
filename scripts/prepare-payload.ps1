#requires -Version 7.0
<#
.SYNOPSIS
Download or use a local Carb release archive, verify it, and prepare .build/.
.EXAMPLE
pwsh -File .\scripts\prepare-payload.ps1
.EXAMPLE
pwsh -File .\scripts\prepare-payload.ps1 -ArchivePath C:\Downloads\Carb-5.6.12-win-x64-portable.zip
#>
[CmdletBinding()]
param(
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$manifestPath = Join-Path $repositoryRoot 'release/windows-x64.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest not found: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
$version = [string] $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'The release manifest must contain a numeric three-part version.'
}
$payloadName = "Carb-$version"
$expectedFilename = "Carb-$version-win-x64-portable.zip"
if ([string] $manifest.portable.filename -cne $expectedFilename) {
    throw "Unexpected portable filename in the release manifest; expected $expectedFilename."
}
$expectedHash = [string] $manifest.portable.sha256
if ($expectedHash -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'The portable SHA-256 in the release manifest is missing or invalid.'
}
$officialUrl = "https://github.com/HIUPAC/Carb/releases/download/v$version/$expectedFilename"
if ([string] $manifest.portable.url -cne $officialUrl) {
    throw "The portable URL must identify the official HIUPAC/Carb release asset: $officialUrl"
}

$buildRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.build'))
$destination = Join-Path $buildRoot $payloadName
if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists; it will not be overwritten: $destination"
}
if ((Test-Path -LiteralPath $buildRoot) -and
    ((Get-Item -LiteralPath $buildRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "The .build directory must not be a symbolic link or junction: $buildRoot"
}

$downloadPath = $null
$stagingPath = $null
$archiveStream = $null
$zip = $null
try {
    $null = [IO.Directory]::CreateDirectory($buildRoot)
    if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
        $downloadPath = Join-Path $buildRoot ('.download-' + [guid]::NewGuid().ToString('N') + '.zip')
        Write-Host "Downloading $expectedFilename from the official GitHub release..."
        Invoke-WebRequest -Uri $officialUrl -OutFile $downloadPath
        $resolvedArchive = $downloadPath
    } else {
        if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
            throw "Local archive not found: $ArchivePath"
        }
        $resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).ProviderPath
    }

    # Keep a read-only handle open through verification and extraction so that
    # another process cannot replace the archive contents on Windows mid-run.
    $archiveStream = [IO.File]::Open($resolvedArchive, [IO.FileMode]::Open,
        [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $actualHash = (Get-FileHash -InputStream $archiveStream -Algorithm SHA256).Hash
    if (-not $actualHash.Equals($expectedHash, [StringComparison]::OrdinalIgnoreCase)) {
        throw "SHA-256 mismatch. Expected $expectedHash; received $actualHash. Nothing was extracted."
    }
    Write-Host 'SHA-256 verified.'
    $archiveStream.Position = 0
    $zip = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Read, $false)
    $entryNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
        $entryPath = $entry.FullName.Replace('\', '/')
        $segments = $entryPath.TrimEnd('/').Split('/')
        if ([string]::IsNullOrEmpty($entryPath) -or $entryPath.StartsWith('/') -or
            $entryPath -match '[:\x00-\x1f]' -or $segments[0] -cne $payloadName -or
            ($segments | Where-Object { $_ -in @('', '.', '..') })) {
            throw "The archive contains an invalid path: $($entry.FullName)"
        }
        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
        if ($unixType -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400)) {
            throw "Archive links and reparse points are not accepted: $($entry.FullName)"
        }
        if (-not $entryNames.Add($entryPath.TrimEnd('/'))) {
            throw "The archive contains a duplicate path: $($entry.FullName)"
        }
    }
    foreach ($required in @("$payloadName/Carb.exe", "$payloadName/resources/app.asar",
        "$payloadName/resources/web/index.html")) {
        if (-not $entryNames.Contains($required)) {
            throw "The archive is missing a required application file: $required"
        }
    }

    $stagingPath = Join-Path $buildRoot ('.prepare-' + [guid]::NewGuid().ToString('N'))
    $null = [IO.Directory]::CreateDirectory($stagingPath)
    [IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip, $stagingPath)
    $stagedPayload = Join-Path $stagingPath $payloadName
    # Directory.Move also refuses a destination created by another process.
    [IO.Directory]::Move($stagedPayload, $destination)
    Write-Host "Prepared release payload: $destination"
    Write-Host ('To start Carb, run: & "' + (Join-Path $destination 'Carb.exe') + '"')
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    if ($null -ne $archiveStream) { $archiveStream.Dispose() }
    if ($null -ne $downloadPath -and (Test-Path -LiteralPath $downloadPath)) {
        Remove-Item -LiteralPath $downloadPath -Force
    }
    if ($null -ne $stagingPath -and (Test-Path -LiteralPath $stagingPath)) {
        $checkedStage = [IO.Path]::GetFullPath($stagingPath)
        $buildPrefix = $buildRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $checkedStage.StartsWith($buildPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not [IO.Path]::GetFileName($checkedStage).StartsWith('.prepare-', [StringComparison]::Ordinal)) {
            throw 'Refusing to clean a staging directory outside the expected .build location.'
        }
        Remove-Item -LiteralPath $checkedStage -Recurse -Force
    }
}
