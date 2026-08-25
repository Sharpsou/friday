[CmdletBinding()]
param(
  [string]$DataDirectory = $(
    if ($env:FRIDAY_DATA_DIR) { $env:FRIDAY_DATA_DIR }
    elseif (Test-Path -LiteralPath 'D:\FridayData') { 'D:\FridayData' }
    else { Join-Path $env:LOCALAPPDATA 'Friday' }
  )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedHash = 'd26b65c432111eb95798cd2320603d4d75627605dbec6c6b7f98c499a80e7321'
$modelUrl = 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26s.onnx'
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$sourceManifest = Join-Path $workspacePath 'robot\models\yolo26s.manifest.json'
$modelDirectory = Join-Path $DataDirectory 'robot\models'
$modelPath = Join-Path $modelDirectory 'yolo26s.onnx'
$manifestPath = Join-Path $modelDirectory 'manifest.json'

New-Item -ItemType Directory -Force -Path $modelDirectory | Out-Null

$validExistingModel =
  (Test-Path -LiteralPath $modelPath) -and
  ((Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedHash)

if (-not $validExistingModel) {
  $temporaryPath = Join-Path $modelDirectory 'yolo26s.download'
  try {
    Invoke-WebRequest -Uri $modelUrl -OutFile $temporaryPath
    $downloadHash = (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($downloadHash -ne $expectedHash) {
      throw "Empreinte inattendue pour YOLO26s : $downloadHash"
    }
    Move-Item -LiteralPath $temporaryPath -Destination $modelPath -Force
  }
  finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

Copy-Item -LiteralPath $sourceManifest -Destination $manifestPath -Force
Write-Host "YOLO26s vérifié : $modelPath" -ForegroundColor Green
Write-Host "Manifeste : $manifestPath"
