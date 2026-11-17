[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:\.\d+)?$')]
    [string] $Version = '5.6.13',
    [string] $PayloadDirectory = 'D:\TasteCode\carb-work\Carb-5.6.13',
    [string] $OutputDirectory = 'D:\TasteCode\安装包',
    [string] $IconFile = 'D:\TasteCode\carb-work\branding\source-shortcut.ico',
    [string] $IsccPath = 'D:\UIAgent\artifacts\build-tools\InnoSetup\ISCC.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$buildRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = (Resolve-Path -LiteralPath $PayloadDirectory).Path.TrimEnd('\')
$iconPath = (Resolve-Path -LiteralPath $IconFile).Path
$compilerPath = (Resolve-Path -LiteralPath $IsccPath).Path
$installerScript = Join-Path $buildRoot 'installer\Carb.iss'
$languageSource = 'D:\UIAgent\installer\ChineseSimplified.isl'
$languageTarget = Join-Path $buildRoot 'installer\ChineseSimplified.isl'
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$verificationRoot = Join-Path $buildRoot 'verification'
& node (Join-Path $PSScriptRoot 'verify-release-artifacts.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Five-format artifact acceptance is missing, failed, stale, or its outputs changed. Re-run tools/verify-artifact-workflow.mjs before packaging.' }
New-Item -ItemType Directory -Path $outputRoot, $verificationRoot -Force | Out-Null
if ($outputRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $outputRoot -eq $sourceRoot) {
    throw 'The installer output directory must be outside the application payload.'
}

function Get-PeCertificateDirectory([string] $Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 64) { return $null }
        $header = [byte[]]::new(64)
        if ($stream.Read($header, 0, 64) -ne 64 -or $header[0] -ne 0x4d -or $header[1] -ne 0x5a) { return $null }
        $peOffset = [BitConverter]::ToInt32($header, 0x3c)
        if ($peOffset -lt 64 -or $peOffset -gt ($stream.Length - 24)) { return $null }
        $null = $stream.Seek($peOffset, [IO.SeekOrigin]::Begin)
        $coff = [byte[]]::new(24)
        if ($stream.Read($coff, 0, 24) -ne 24 -or $coff[0] -ne 0x50 -or $coff[1] -ne 0x45 -or $coff[2] -ne 0 -or $coff[3] -ne 0) { return $null }
        $optionalSize = [BitConverter]::ToUInt16($coff, 20)
        $optional = [byte[]]::new($optionalSize)
        if ($optionalSize -lt 2 -or $stream.Read($optional, 0, $optionalSize) -ne $optionalSize) { throw "Incomplete PE optional header: $Path" }
        $magic = [BitConverter]::ToUInt16($optional, 0)
        if ($magic -eq 0x10b) { $securityEntry = 96 + (4 * 8) }
        elseif ($magic -eq 0x20b) { $securityEntry = 112 + (4 * 8) }
        else { throw "Unsupported PE optional-header format: $Path" }
        if ($securityEntry + 8 -gt $optional.Length) { throw "Missing PE security-directory entry: $Path" }
        $offset = [uint64][BitConverter]::ToUInt32($optional, $securityEntry)
        $bytes = [uint64][BitConverter]::ToUInt32($optional, $securityEntry + 4)
        if (($offset -eq 0) -xor ($bytes -eq 0)) { throw "Incomplete PE security-directory pointer: $Path" }
        if ($bytes -gt 0 -and ($offset -gt [uint64]$stream.Length -or $bytes -gt ([uint64]$stream.Length - $offset))) { throw "PE certificate table exceeds file: $Path" }
        [pscustomobject]@{ path = $Path; certificateOffset = $offset; certificateBytes = $bytes; hasEmbeddedCertificate = ($offset -ne 0 -or $bytes -ne 0) }
    } finally { $stream.Dispose() }
}

$required = @('Carb.exe', 'resources\app.asar', 'resources\web\index.html',
    'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources\LICENSE', 'resources\NOTICE')
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relative) -PathType Leaf)) { throw "Missing application payload: $relative" }
}
$brandingPath = Join-Path $buildRoot 'payload-metadata\branding-manifest.json'
$branding = Get-Content -LiteralPath $brandingPath -Raw | ConvertFrom-Json
if ($branding.productName -ne 'Carb' -or $branding.executable -ne 'Carb.exe') { throw 'Payload branding must identify Carb.exe / Carb.' }
$versionInfo = (Get-Item -LiteralPath (Join-Path $sourceRoot 'Carb.exe')).VersionInfo
if ($versionInfo.ProductName -ne 'Carb' -or $versionInfo.CompanyName -ne '冰轮') { throw 'Carb.exe has unexpected PE branding.' }
$sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force)
function Test-DevelopmentPayloadPath([string] $RelativePath) {
    $normalized = $RelativePath.Replace('\', '/')
    if ($normalized -match '(^|/)(tests?|(?:[^/]+-)?fixtures|evals)/' -or
        $normalized -match '\.(map|log)$' -or
        $normalized -match '(^|/)(branding-manifest\.json|japanese-native-patch-report\.json)$') { return $true }
    $normalized -in @(
        'resources/app.asar.unpacked/node_modules/@harness/design-agent/references/library/README.md',
        'resources/app.asar.unpacked/node_modules/@harness/design-agent/references/app-screens/README.md',
        'node_modules/@harness/design-agent/references/library/README.md',
        'node_modules/@harness/design-agent/references/app-screens/README.md',
        'resources/default-skills/skills/design-taste-frontend/README.md'
    )
}
function Get-AsarMemberPaths($Files, [string] $Prefix = '') {
    foreach ($property in $Files.PSObject.Properties) {
        $relative = $Prefix + $property.Name
        $entry = $property.Value
        if ($null -ne $entry.PSObject.Properties['files']) {
            Get-AsarMemberPaths $entry.files ($relative + '/')
        } else { $relative }
    }
}
$developmentFiles = @(foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1)
    if (Test-DevelopmentPayloadPath $relative) { $relative }
})
$asarBytes = [IO.File]::ReadAllBytes((Join-Path $sourceRoot 'resources\app.asar'))
if ($asarBytes.Length -lt 16 -or [BitConverter]::ToUInt32($asarBytes, 0) -ne 4) { throw 'The application ASAR header is invalid.' }
$asarJsonBytes = [BitConverter]::ToUInt32($asarBytes, 12)
if ($asarJsonBytes -gt ($asarBytes.Length - 16)) { throw 'The application ASAR header exceeds the archive.' }
$asarHeader = [Text.Encoding]::UTF8.GetString($asarBytes, 16, $asarJsonBytes) | ConvertFrom-Json
$developmentFiles += @(foreach ($member in @(Get-AsarMemberPaths $asarHeader.files)) {
    if (Test-DevelopmentPayloadPath $member) { "resources/app.asar::$member" }
})
$asarBytes = $null
if ($developmentFiles.Count -gt 0) {
    throw ('Remove development attachments before packaging: ' + ($developmentFiles -join ', '))
}
if (@($sourceFiles | Where-Object { $_.Extension -in @('.pfx', '.p12', '.pem', '.key') }).Count -gt 0) {
    throw 'Private certificate/key material must not be included in an installer payload.'
}
if (-not (Test-Path -LiteralPath $languageTarget -PathType Leaf)) {
    Copy-Item -LiteralPath $languageSource -Destination $languageTarget
}
if ((Get-FileHash -LiteralPath $languageSource -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $languageTarget -Algorithm SHA256).Hash) {
    throw 'The Chinese installer language file differs from the reviewed source.'
}

$existingInstaller = Join-Path $outputRoot "Carb-Setup-$Version-win-x64.exe"
if (Test-Path -LiteralPath $existingInstaller) { throw "Installer output already exists: $existingInstaller" }

$arguments = @("/DAppVersion=$Version", "/DPayloadDir=$sourceRoot", "/DOutputDir=$outputRoot", "/DIconFile=$iconPath")
$signatureRecords = @(foreach ($file in $sourceFiles) { $record = Get-PeCertificateDirectory $file.FullName; if ($null -ne $record) { $record } })
$embeddedSignatures = @($signatureRecords | Where-Object { $_.hasEmbeddedCertificate })
$signatureAudit = [ordered]@{
    schemaVersion = 1
    inspectedAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceDirectory = $sourceRoot
    inspectedFileCount = $sourceFiles.Count
    peFileCount = $signatureRecords.Count
    embeddedSignatureCount = $embeddedSignatures.Count
    limitation = 'Checks PE embedded certificate-table presence; external Windows catalog signatures are machine-level state.'
    files = $signatureRecords
}
$signatureAudit | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $verificationRoot "payload-signature-audit-$Version.json") -Encoding utf8
if ($embeddedSignatures.Count -gt 0) { throw "The payload still contains $($embeddedSignatures.Count) PE embedded certificate tables. Complete signature removal before packaging." }
$payloadRecords = @(foreach ($file in $sourceFiles) {
    $current = Get-Item -LiteralPath $file.FullName
    [ordered]@{
        path = $current.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
        bytes = $current.Length
        sha256 = (Get-FileHash -LiteralPath $current.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$arguments += $installerScript
$logPath = Join-Path $verificationRoot 'installer-compiler.log'
Write-Host "Packaging $($payloadRecords.Count) application files..."
& $compilerPath @arguments 2>&1 | Tee-Object -FilePath $logPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed ($LASTEXITCODE). See $logPath" }
$installerPath = Join-Path $outputRoot "Carb-Setup-$Version-win-x64.exe"
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw 'The compiler did not create the expected installer.' }
foreach ($record in $payloadRecords) {
    $currentPath = Join-Path $sourceRoot $record.path
    if ((Get-FileHash -LiteralPath $currentPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) {
        throw "Payload changed during compilation: $($record.path)"
    }
}
$installer = Get-Item -LiteralPath $installerPath
$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = Get-AuthenticodeSignature -LiteralPath $installerPath
$installerCertificateDirectory = Get-PeCertificateDirectory $installerPath
if ($installerCertificateDirectory.hasEmbeddedCertificate) { throw 'The generated installer has an unexpected embedded certificate table.' }
$manifest = [ordered]@{
    schemaVersion = 1
    productName = 'Carb'
    publisherDisplayName = '冰轮'
    version = $Version
    architecture = 'win-x64'
    installerLanguages = @('简体中文（默认）', 'English', '日本語')
    builtAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceDirectory = $sourceRoot
    installer = $installer.Name
    bytes = $installer.Length
    sha256 = $hash
    signatureStatus = [string]$signature.Status
    signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    signedUninstaller = $false
    payloadSigningScope = 'All PE embedded certificate tables absent'
    payloadPeFileCount = $signatureRecords.Count
    payloadEmbeddedSignatureCount = $embeddedSignatures.Count
    installerEmbeddedSignatureCount = [int]$installerCertificateDirectory.hasEmbeddedCertificate
    signatureAudit = "payload-signature-audit-$Version.json"
    defaultInstallDirectory = '%LocalAppData%\Programs\Carb'
    executable = 'Carb.exe'
    payloadFileCount = $payloadRecords.Count
    payloadBytes = [long](($payloadRecords | ForEach-Object { [long]$_.bytes } | Measure-Object -Sum).Sum)
    files = $payloadRecords
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot "Carb-Setup-$Version-win-x64.manifest.json") -Encoding utf8
($hash + '  ' + $installer.Name) | Set-Content -LiteralPath "$installerPath.sha256" -Encoding ascii
[pscustomobject]@{ Installer = $installerPath; Bytes = $installer.Length; SHA256 = $hash; SignatureStatus = [string]$signature.Status; PayloadFiles = $payloadRecords.Count } | ConvertTo-Json
