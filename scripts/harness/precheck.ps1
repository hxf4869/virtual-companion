[CmdletBinding()]
param(
    [string]$Task,
    [string]$Profile = "precheck"
)

$arguments = @("scripts/harness/precheck.py", "--profile", $Profile)
if ($Task) {
    $arguments += @("--task", $Task)
}

$candidates = @(
    # Respect activated virtual environments and actions/setup-python first.
    @{ Command = "python"; Prefix = @() },
    @{ Command = "python3"; Prefix = @() },
    @{ Command = "py"; Prefix = @("-3") }
)

$selected = $null
foreach ($candidate in $candidates) {
    $commandName = $candidate.Command
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        continue
    }
    $probeArguments = @()
    $probeArguments += $candidate.Prefix
    $probeArguments += @("-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 2)")
    & $commandName @probeArguments *> $null
    if ($LASTEXITCODE -eq 0) {
        $selected = $candidate
        break
    }
}

if ($null -eq $selected) {
    Write-Error "Python 3.11+ is required"
    exit 2
}

$selectedCommand = $selected.Command
$selectedArguments = @()
$selectedArguments += $selected.Prefix
$selectedArguments += $arguments
& $selectedCommand @selectedArguments
exit $LASTEXITCODE
