#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateSet("Launch", "Worker")]
    [string]$Mode = "Launch",
    [string]$RequestPath,
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-ExactKeys {
    param([hashtable]$Value, [string[]]$Keys, [string]$Label)
    $actual = @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    $expected = @($Keys | Sort-Object)
    if (($actual -join "`n") -cne ($expected -join "`n")) {
        throw "$Label must contain exactly: $($expected -join ', ')"
    }
}

function Read-JsonObject {
    param([string]$Path, [string]$Label)
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or
        -not [IO.File]::Exists($Path)) {
        throw "$Label must be an existing absolute file"
    }
    $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
        ConvertFrom-Json -AsHashtable -Depth 20
    if ($value -isnot [hashtable]) {
        throw "$Label must contain a JSON object"
    }
    return $value
}

function Write-AtomicUtf8Json {
    param([hashtable]$Value, [string]$Destination)
    $temporary = "$Destination.tmp"
    if ([IO.File]::Exists($Destination) -or [IO.File]::Exists($temporary)) {
        throw "atomic destination already exists"
    }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(
        (($Value | ConvertTo-Json -Depth 20 -Compress) + "`n")
    )
    $stream = [IO.FileStream]::new(
        $temporary,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
    [IO.File]::Move($temporary, $Destination)
}

if (-not $IsWindows) {
    throw "DURABLE_ATOMIC_RECEIPT is Windows-only; use a direct persistent session or PTY"
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7 or newer is required; PowerShell 5.1 fallback is forbidden"
}

if ($Mode -eq "Launch") {
    $request = Read-JsonObject -Path $RequestPath -Label "request"
    Assert-ExactKeys $request @(
        "schemaVersion", "executable", "argv", "workingDirectory"
    ) "request"
    if ($request.schemaVersion -ne 1) {
        throw "request.schemaVersion must be 1"
    }
    if ($request.executable -isnot [string] -or
        -not [IO.Path]::IsPathFullyQualified($request.executable) -or
        -not [IO.File]::Exists($request.executable)) {
        throw "request.executable must be an existing absolute file"
    }
    if ($request.workingDirectory -isnot [string] -or
        -not [IO.Path]::IsPathFullyQualified($request.workingDirectory) -or
        -not [IO.Directory]::Exists($request.workingDirectory)) {
        throw "request.workingDirectory must be an existing absolute directory"
    }
    if ($request.argv -isnot [object[]] -or
        @($request.argv | Where-Object { $_ -isnot [string] }).Count -ne 0) {
        throw "request.argv must be an array of strings"
    }

    $runDirectory = Join-Path ([IO.Path]::GetTempPath()) (
        "virtual-companion-durable-" + [Guid]::NewGuid().ToString("N")
    )
    [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $config = @{
        schemaVersion = 1
        executable = $request.executable
        argv = @($request.argv)
        workingDirectory = $request.workingDirectory
        stdoutPath = Join-Path $runDirectory "stdout.bin"
        stderrPath = Join-Path $runDirectory "stderr.bin"
        receiptPath = Join-Path $runDirectory "receipt.json"
    }
    $workerConfigPath = Join-Path $runDirectory "config.json"
    Write-AtomicUtf8Json -Value $config -Destination $workerConfigPath

    $scriptPath = $PSCommandPath.Replace("'", "''")
    $escapedConfig = $workerConfigPath.Replace("'", "''")
    $workerCommand = "& '$scriptPath' -Mode Worker -ConfigPath '$escapedConfig'"
    $encoded = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($workerCommand)
    )
    $pwshPath = (Get-Process -Id $PID).Path
    $process = Start-Process -FilePath $pwshPath -ArgumentList @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", $encoded
    ) -WindowStyle Hidden -PassThru
    [ordered]@{
        schemaVersion = 1
        transport = "DURABLE_ATOMIC_RECEIPT"
        workerPid = $process.Id
        runDirectory = $runDirectory
        configPath = $workerConfigPath
        stdoutPath = $config.stdoutPath
        stderrPath = $config.stderrPath
        receiptPath = $config.receiptPath
    } | ConvertTo-Json -Compress
    exit 0
}

$config = Read-JsonObject -Path $ConfigPath -Label "config"
Assert-ExactKeys $config @(
    "schemaVersion", "executable", "argv", "workingDirectory",
    "stdoutPath", "stderrPath", "receiptPath"
) "config"
if ($config.schemaVersion -ne 1) {
    throw "config.schemaVersion must be 1"
}
$runDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ConfigPath))
foreach ($field in @("stdoutPath", "stderrPath", "receiptPath")) {
    $path = $config[$field]
    if ($path -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($path) -or
        [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($path)) -cne $runDirectory) {
        throw "config.$field must be an absolute path in the config directory"
    }
}
if ($config.executable -isnot [string] -or
    -not [IO.Path]::IsPathFullyQualified($config.executable) -or
    -not [IO.File]::Exists($config.executable)) {
    throw "config.executable must be an existing absolute file"
}
if ($config.workingDirectory -isnot [string] -or
    -not [IO.Path]::IsPathFullyQualified($config.workingDirectory) -or
    -not [IO.Directory]::Exists($config.workingDirectory)) {
    throw "config.workingDirectory must be an existing absolute directory"
}
if ($config.argv -isnot [object[]] -or
    @($config.argv | Where-Object { $_ -isnot [string] }).Count -ne 0) {
    throw "config.argv must be an array of strings"
}

$startedAt = [DateTimeOffset]::UtcNow
$stdout = $null
$stderr = $null
$process = $null
$exitCode = $null
$failure = $null
try {
    $stdout = [IO.FileStream]::new(
        $config.stdoutPath, [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write, [IO.FileShare]::Read
    )
    $stderr = [IO.FileStream]::new(
        $config.stderrPath, [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write, [IO.FileShare]::Read
    )
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $config.executable
    $startInfo.WorkingDirectory = $config.workingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $config.argv) {
        $startInfo.ArgumentList.Add($argument)
    }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "inner process did not start"
    }
    $stdoutDrain = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
    $stderrDrain = $process.StandardError.BaseStream.CopyToAsync($stderr)
    $process.WaitForExit()
    $stdoutDrain.GetAwaiter().GetResult()
    $stderrDrain.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
}
catch {
    $failure = $_.Exception.Message
}
finally {
    if ($null -ne $stdout) {
        $stdout.Flush($true)
        $stdout.Dispose()
    }
    if ($null -ne $stderr) {
        $stderr.Flush($true)
        $stderr.Dispose()
    }
    if ($null -ne $process) {
        $process.Dispose()
    }
}

$receipt = [ordered]@{
    schemaVersion = 1
    transport = "DURABLE_ATOMIC_RECEIPT"
    status = if ($null -eq $failure) { "COMPLETED" } else { "WORKER_FAILED" }
    executable = $config.executable
    argv = @($config.argv)
    workingDirectory = $config.workingDirectory
    startedAt = $startedAt.ToString("O")
    completedAt = [DateTimeOffset]::UtcNow.ToString("O")
    exitCode = $exitCode
    failure = $failure
    configSha256 = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash.ToLowerInvariant()
    stdoutPath = $config.stdoutPath
    stdoutBytes = if ([IO.File]::Exists($config.stdoutPath)) { ([IO.FileInfo]$config.stdoutPath).Length } else { 0 }
    stdoutSha256 = if ([IO.File]::Exists($config.stdoutPath)) { (Get-FileHash -LiteralPath $config.stdoutPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    stderrPath = $config.stderrPath
    stderrBytes = if ([IO.File]::Exists($config.stderrPath)) { ([IO.FileInfo]$config.stderrPath).Length } else { 0 }
    stderrSha256 = if ([IO.File]::Exists($config.stderrPath)) { (Get-FileHash -LiteralPath $config.stderrPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
}
Write-AtomicUtf8Json -Value $receipt -Destination $config.receiptPath
exit 0
