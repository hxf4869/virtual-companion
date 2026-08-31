[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

Push-Location $repositoryRoot
try {
    if (-not $env:VC_MODE) {
        $env:VC_MODE = 'full'
    }
    & go -C backend run ./cmd/companiond
    if ($LASTEXITCODE -ne 0) {
        throw "后端启动失败，退出码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
