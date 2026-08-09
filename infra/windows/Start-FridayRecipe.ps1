[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$NoBrowser,
  [switch]$ExitAfterHealthCheck,
  [switch]$RestartExisting,
  [switch]$KeepHubRunning,
  [switch]$ShowStatusPopup,
  [ValidateRange(5, 120)]
  [int]$HealthTimeoutSeconds = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-FridayMessage {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$TimeoutSeconds = 5,
    [int]$Icon = 64
  )

  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.Popup($Message, $TimeoutSeconds, 'Friday', $Icon)
}

trap {
  if ($ShowStatusPopup) {
    Show-FridayMessage `
      -Message "Friday n'a pas pu demarrer. Utilise 'Lancer et recetter' pour afficher le detail." `
      -TimeoutSeconds 8 `
      -Icon 16
  }
  else {
    Write-Host ''
    Write-Host 'Friday n’a pas pu démarrer.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Lanceur : $PSCommandPath"
    if (-not $ExitAfterHealthCheck) {
      Read-Host 'Appuyez sur Entrée pour fermer cette fenêtre' | Out-Null
    }
  }
  exit 1
}

function Get-FridayChromePath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  throw 'Google Chrome est introuvable. Installez Chrome avant de lancer la recette.'
}

function Get-FridayLanContext {
  $configuration = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1

  if ($configuration -and $configuration.IPv4Address) {
    $profile = Get-NetConnectionProfile `
      -InterfaceIndex $configuration.InterfaceIndex `
      -ErrorAction SilentlyContinue
    return [PSCustomObject]@{
      Address = $configuration.IPv4Address.IPAddress
      InterfaceAlias = $configuration.InterfaceAlias
      NetworkCategory = $profile.NetworkCategory
      NetworkName = $profile.Name
    }
  }

  return $null
}

function Test-FridayHealth {
  param([Parameter(Mandatory = $true)][string]$Uri)

  try {
    $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 2
    return $response.status -eq 'ok'
  }
  catch {
    return $false
  }
}

$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$recipePath = Join-Path $workspacePath 'docs\recipes\galaxy-a17-p0.md'
$packageManagerShimDirectory = Join-Path $PSScriptRoot 'bin'
$nodeCommand = Get-Command node -ErrorAction Stop
$corepackCommand = Get-Command corepack -ErrorAction SilentlyContinue
if ($corepackCommand) {
  $env:Path = "$packageManagerShimDirectory;$env:Path"
  $packageManagerCommand = Get-Command pnpm -ErrorAction Stop
}
else {
  $packageManagerCommand = Get-Command pnpm -ErrorAction Stop
}
$chromePath = if ($NoBrowser) { $null } else { Get-FridayChromePath }

$dataDirectory = if ($env:FRIDAY_DATA_DIR) {
  $env:FRIDAY_DATA_DIR
}
elseif (Test-Path -LiteralPath 'D:\FridayData') {
  'D:\FridayData'
}
else {
  Join-Path $env:LOCALAPPDATA 'Friday'
}

$certificatePath = if ($env:FRIDAY_TLS_CERT_PATH) {
  $env:FRIDAY_TLS_CERT_PATH
}
else {
  Join-Path $dataDirectory 'certificates\friday-lan.pem'
}
$keyPath = if ($env:FRIDAY_TLS_KEY_PATH) {
  $env:FRIDAY_TLS_KEY_PATH
}
else {
  Join-Path $dataDirectory 'secrets\friday-lan-key.pem'
}

$certificateExists = Test-Path -LiteralPath $certificatePath
$keyExists = Test-Path -LiteralPath $keyPath
if ($certificateExists -xor $keyExists) {
  throw 'Configuration TLS incomplète : le certificat et la clé Friday doivent être présents ensemble.'
}

$tlsReady = $certificateExists -and $keyExists
$lanContext = if ($tlsReady) { Get-FridayLanContext } else { $null }
$lanReady =
  $tlsReady -and
  $lanContext -and
  $lanContext.NetworkCategory -eq 'Private'
$scheme = if ($tlsReady) { 'https' } else { 'http' }
$localUrl = "${scheme}://127.0.0.1:8443"
$healthUrl = "$localUrl/api/health"
$phoneUrl = if ($lanReady) {
  "https://$($lanContext.Address):8443"
}
else {
  $null
}

$env:FRIDAY_DATA_DIR = $dataDirectory
$env:FRIDAY_PORT = '8443'
$env:FRIDAY_PUBLIC_ORIGIN = if ($lanReady) { $phoneUrl } else { $localUrl }
$trustedOrigins = @($localUrl)
if ($phoneUrl) {
  $trustedOrigins += $phoneUrl
}
$env:FRIDAY_TRUSTED_ORIGINS = $trustedOrigins -join ','
if ($tlsReady) {
  $env:FRIDAY_HOST = if ($lanReady) { '0.0.0.0' } else { '127.0.0.1' }
  $env:FRIDAY_TLS_CERT_PATH = $certificatePath
  $env:FRIDAY_TLS_KEY_PATH = $keyPath
}
else {
  $env:FRIDAY_HOST = '127.0.0.1'
  Remove-Item Env:FRIDAY_TLS_CERT_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:FRIDAY_TLS_KEY_PATH -ErrorAction SilentlyContinue
}

Push-Location $workspacePath
$hubProcess = $null
$hubReady = $false
try {
  if ($ShowStatusPopup) {
    Show-FridayMessage `
      -Message 'Friday demarre. Cela peut prendre quelques secondes.' `
      -TimeoutSeconds 2
  }

  Write-Host ''
  Write-Host 'Friday - lancement du candidat de recette' -ForegroundColor Cyan
  Write-Host "Données : $dataDirectory"

  if (-not $SkipBuild) {
    Write-Host 'Construction de la PWA et du hub...'
    & $packageManagerCommand.Source build
    if ($LASTEXITCODE -ne 0) {
      throw "La construction a échoué avec le code $LASTEXITCODE."
    }
  }

  $hubEntryPoint = Join-Path $workspacePath 'apps\hub\dist\main.js'
  if (-not (Test-Path -LiteralPath $hubEntryPoint)) {
    throw "Le hub construit est introuvable : $hubEntryPoint"
  }

  if ($RestartExisting) {
    $listenerProcessIds = Get-NetTCPConnection `
      -LocalPort 8443 `
      -State Listen `
      -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($listenerProcessId in $listenerProcessIds) {
      $listenerProcess = Get-CimInstance `
        Win32_Process `
        -Filter "ProcessId=$listenerProcessId"
      $isFridayHub =
        $listenerProcess -and
        $listenerProcess.Name -eq 'node.exe' -and
        $listenerProcess.CommandLine -like "*$hubEntryPoint*"
      if (-not $isFridayHub) {
        throw "Le port 8443 est utilisé par un processus qui n'est pas le hub Friday (PID $listenerProcessId)."
      }

      $existingProcess = Get-Process -Id $listenerProcessId -ErrorAction Stop
      Stop-Process -Id $listenerProcessId -ErrorAction Stop
      $existingProcess.WaitForExit(5000) | Out-Null
    }
  }

  $alreadyRunning = Test-FridayHealth -Uri $healthUrl
  if (-not $alreadyRunning) {
    $startParameters = @{
      FilePath = $nodeCommand.Source
      ArgumentList = @($hubEntryPoint)
      WorkingDirectory = $workspacePath
      PassThru = $true
    }
    if ($KeepHubRunning) {
      $startParameters['WindowStyle'] = 'Hidden'
    }
    else {
      $startParameters['NoNewWindow'] = $true
    }

    $hubProcess = Start-Process @startParameters

    $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
      if ($hubProcess.HasExited) {
        throw "Le hub s'est arrêté avec le code $($hubProcess.ExitCode)."
      }
      if (Test-FridayHealth -Uri $healthUrl) {
        break
      }
      Start-Sleep -Milliseconds 250
    }

    if (-not (Test-FridayHealth -Uri $healthUrl)) {
      throw "Friday n'a pas répondu sur $healthUrl dans le délai prévu."
    }
    $hubReady = $true
  }
  else {
    $hubReady = $true
  }

  Write-Host ''
  Write-Host "Friday répond : $localUrl" -ForegroundColor Green
  if ($phoneUrl) {
    Write-Host "Galaxy A17 : $phoneUrl" -ForegroundColor Green
  }
  elseif ($tlsReady -and $lanContext) {
    Write-Host (
      "Accès A17 désactivé : le réseau '$($lanContext.NetworkName)' est classé $($lanContext.NetworkCategory)."
    ) -ForegroundColor Yellow
    Write-Host 'Exécutez le raccourci Friday - Configurer accès A17.' -ForegroundColor Yellow
  }
  else {
    Write-Host 'Mode local uniquement : le certificat LAN n’est pas encore configuré.' -ForegroundColor Yellow
  }
  Write-Host "Recette détaillée : $recipePath"
  Write-Host 'Mini-recette : créer une tâche, recharger hors ligne, puis rétablir le réseau et vérifier la synchronisation.'

  if ($ShowStatusPopup) {
    $availableMessage = if ($phoneUrl) {
      "Friday est disponible sur ton mobile.`n$phoneUrl"
    }
    else {
      "Friday est disponible sur ce PC.`n$localUrl"
    }
    Show-FridayMessage -Message $availableMessage
  }

  if (-not $NoBrowser -and $chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList @('--new-window', $localUrl)
  }

  if ($ExitAfterHealthCheck) {
    return
  }

  if ($alreadyRunning) {
    Write-Host 'Une instance existait déjà ; le raccourci ne l’arrêtera pas.'
    Read-Host 'Appuyez sur Entrée pour fermer cette fenêtre' | Out-Null
  }
  else {
    Write-Host ''
    Read-Host 'Appuyez sur Entrée pour arrêter Friday après la recette' | Out-Null
  }
}
finally {
  $mustStopHub = -not $KeepHubRunning -or -not $hubReady
  if ($hubProcess -and -not $hubProcess.HasExited -and $mustStopHub) {
    Stop-Process -Id $hubProcess.Id -ErrorAction SilentlyContinue
    $hubProcess.WaitForExit(5000) | Out-Null
  }
  Pop-Location
}
