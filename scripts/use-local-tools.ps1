# Chỉ thêm runtime portable của dự án vào phiên PowerShell hiện tại.
$projectTools = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.tools'))
$localNode = Join-Path $projectTools 'node-v24.20.0-win-x64'
$localGit = Join-Path $projectTools 'git\cmd'
if (Test-Path -LiteralPath (Join-Path $localNode 'node.exe')) { $env:Path = $localNode + ';' + $env:Path }
if (Test-Path -LiteralPath (Join-Path $localGit 'git.exe')) { $env:Path = $localGit + ';' + $env:Path }
