[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if ($repositoryRoot -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "仓库不在可转换的 Windows 盘符路径中：$repositoryRoot"
}

$drive = $Matches[1].ToLowerInvariant()
$relativePath = $Matches[2].Replace('\', '/')
$linuxRepositoryRoot = "/mnt/$drive/$relativePath"
$mavenImage = 'maven:3.9.16-eclipse-temurin-25-noble@sha256:7e461cec477077c1d9e50b13df8aef9018764410f4c4cd7c34803f10c4c99e4c'
$containerName = "virtual-companion-runtime-smoke-$([guid]::NewGuid().ToString('N'))"

# Resolve the newest runtime jar so a version bump does not break the script.
$runtimeJar = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'service\apps\runtime\target') -Filter 'virtual-companion-runtime-*.jar' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $runtimeJar) {
    throw '未找到 Runtime JAR，请先运行 .\scripts\dev\maven-verify.ps1。'
}
$containerJarPath = "/workspace/service/apps/runtime/target/$($runtimeJar.Name)"
$containerStarted = $false

try {
    & wsl.exe -d Ubuntu-24.04 -u root -- docker run --rm --detach `
        --name $containerName `
        --publish '127.0.0.1:18080:8080' `
        --volume "${linuxRepositoryRoot}:/workspace:ro" `
        $mavenImage `
        java -jar $containerJarPath | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "无法启动后端冒烟容器，退出码：$LASTEXITCODE"
    }
    $containerStarted = $true

    $health = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/actuator/health' -TimeoutSec 2
            break
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }

    if ($null -eq $health) {
        & wsl.exe -d Ubuntu-24.04 -u root -- docker logs $containerName
        throw '后端未在 30 秒内通过健康检查。'
    }

    $baseline = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/api/internal/baseline' -TimeoutSec 5
    if (
        $health.status -ne 'UP' -or
        $baseline.phase -ne 'TECHNICAL_ALPHA' -or
        $baseline.transport -ne 'HTTP_SSE' -or
        $baseline.technology.javaVersion -ne '25-LTS' -or
        $baseline.catalogs.riskLevels[0] -ne 'R0_NORMAL'
    ) {
        throw '后端冒烟响应与机器基线不一致。'
    }

    [pscustomobject]@{
        health = $health.status
        phase = $baseline.phase
        transport = $baseline.transport
        javaBaseline = $baseline.technology.javaVersion
        firstRiskLevel = $baseline.catalogs.riskLevels[0]
    } | ConvertTo-Json
}
finally {
    if ($containerStarted) {
        & wsl.exe -d Ubuntu-24.04 -u root -- docker stop --time 5 $containerName | Out-Null
    }
}
