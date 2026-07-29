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

& wsl.exe -d Ubuntu-24.04 -u root -- docker run --rm `
    --volume "${linuxRepositoryRoot}:/workspace" `
    --volume "virtual-companion-maven-cache:/root/.m2" `
    --workdir /workspace `
    $mavenImage `
    ./mvnw --batch-mode --no-transfer-progress verify

if ($LASTEXITCODE -ne 0) {
    throw "Maven 容器验证失败，退出码：$LASTEXITCODE"
}
