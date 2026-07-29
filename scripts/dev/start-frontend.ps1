[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

& pnpm --dir (Join-Path $repositoryRoot 'frontend') dev:h5

if ($LASTEXITCODE -ne 0) {
    throw "前端启动失败，退出码：$LASTEXITCODE"
}
