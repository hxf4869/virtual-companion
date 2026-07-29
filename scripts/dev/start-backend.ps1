[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

Push-Location $repositoryRoot
try {
    & .\mvnw.cmd --projects service/apps/runtime --also-make spring-boot:run
    if ($LASTEXITCODE -ne 0) {
        throw "后端启动失败，退出码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
