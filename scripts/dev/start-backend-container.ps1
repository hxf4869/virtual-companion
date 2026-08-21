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
# Resolve the newest runtime jar so a version bump does not break the script.
$runtimeJar = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot 'service\apps\runtime\target') -Filter 'virtual-companion-runtime-*.jar' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $runtimeJar) {
    throw '未找到 Runtime JAR，请先运行 .\scripts\dev\maven-verify.ps1。'
}
$containerJarPath = "/workspace/service/apps/runtime/target/$($runtimeJar.Name)"

& wsl.exe -d Ubuntu-24.04 -u root -- docker run --rm `
    --publish '127.0.0.1:8080:8080' `
    --volume "${linuxRepositoryRoot}:/workspace:ro" `
    $mavenImage `
    java -jar $containerJarPath

if ($LASTEXITCODE -notin @(0, 130, 143)) {
    throw "后端容器退出，退出码：$LASTEXITCODE"
}
