$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'resolver')
if (-not $env:DLHD_BASE) { $env:DLHD_BASE = 'https://thedaddy.li' }
$env:PORT = '3000'
node dist/api/index.js
