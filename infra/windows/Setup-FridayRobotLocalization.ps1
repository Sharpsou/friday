[CmdletBinding()]
param(
  [string]$DataDirectory,
  [string]$PythonCommand = 'python'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$resolvedDataDirectory = if ($DataDirectory) {
  [System.IO.Path]::GetFullPath($DataDirectory)
}
elseif (Test-Path -LiteralPath 'D:\FridayData') {
  'D:\FridayData'
}
else {
  Join-Path $env:LOCALAPPDATA 'Friday'
}
$runtimeDirectory = Join-Path $resolvedDataDirectory 'robot\localization-venv'
$pythonPath = Join-Path $runtimeDirectory 'Scripts\python.exe'
$requirementsPath = Join-Path $workspacePath 'tools\robot-localization\requirements.txt'

if (-not (Test-Path -LiteralPath $requirementsPath)) {
  throw "Dépendances de reconnaissance de lieux introuvables : $requirementsPath"
}
if (-not (Test-Path -LiteralPath $pythonPath)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeDirectory) -Force | Out-Null
  & $PythonCommand -m venv $runtimeDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "La création de l'environnement Python de reconnaissance a échoué."
  }
}

& $pythonPath -m pip install --disable-pip-version-check -r $requirementsPath
if ($LASTEXITCODE -ne 0) {
  throw "L'installation d'OpenCV headless a échoué."
}
& $pythonPath -c 'import cv2; print(cv2.__version__)'
if ($LASTEXITCODE -ne 0) {
  throw 'OpenCV est installé mais ne peut pas être importé.'
}

Write-Host "Reconnaissance de lieux prête : $pythonPath" -ForegroundColor Green
