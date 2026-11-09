$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$target = Join-Path $PSScriptRoot 'resolver'
if (Test-Path -LiteralPath $target) { throw 'Le dossier resolver existe déjà. Aucun fichier modifié.' }
git clone https://github.com/Lunatic16/daddylive-stream-resolver.git $target
if ($LASTEXITCODE -ne 0) { throw 'Téléchargement impossible' }
Set-Location $target
git checkout cf97fcd382a252f6557d7b85094477eba98e905b
if ($LASTEXITCODE -ne 0) { throw 'Version du resolver introuvable' }
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'Installation impossible' }
& .\node_modules\.bin\tsc.cmd
if ($LASTEXITCODE -ne 0) { throw 'Compilation impossible' }
Copy-Item src/web/style.css dist/web/style.css
Write-Host 'Resolver prêt. Lancez start-resolver.ps1 dans un second terminal.'
