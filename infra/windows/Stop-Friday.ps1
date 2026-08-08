[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8443
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-FridayMessage {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$Icon = 64
  )

  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.Popup($Message, 5, 'Friday', $Icon)
}

trap {
  Show-FridayMessage `
    -Message ("Friday tourne toujours. Detail : " + $_.Exception.Message) `
    -Icon 16
  exit 1
}

$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$hubEntryPoint = Join-Path $workspacePath 'apps\hub\dist\main.js'
$listenerProcessIds = @(
  Get-NetTCPConnection `
    -LocalPort $Port `
    -State Listen `
    -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
)

if ($listenerProcessIds.Count -eq 0) {
  Show-FridayMessage 'Friday ne tourne pas. Le test hors ligne peut commencer.'
  exit 0
}

$processesToStop = @()
foreach ($listenerProcessId in $listenerProcessIds) {
  $listenerProcess = Get-CimInstance `
    Win32_Process `
    -Filter "ProcessId=$listenerProcessId"
  $isFridayHub =
    $listenerProcess -and
    $listenerProcess.Name -eq 'node.exe' -and
    $listenerProcess.CommandLine -and
    $listenerProcess.CommandLine.IndexOf(
      $hubEntryPoint,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -ge 0

  if (-not $isFridayHub) {
    throw "Le port $Port est utilise par un autre programme (PID $listenerProcessId)."
  }

  $processesToStop += Get-Process -Id $listenerProcessId -ErrorAction Stop
}

foreach ($process in $processesToStop) {
  Stop-Process -Id $process.Id -ErrorAction Stop
  $process.WaitForExit(5000) | Out-Null
}

$remainingListeners = @(
  Get-NetTCPConnection `
    -LocalPort $Port `
    -State Listen `
    -ErrorAction SilentlyContinue
)
if ($remainingListeners.Count -gt 0) {
  throw "Le port $Port est encore ouvert."
}

Show-FridayMessage 'Friday ne tourne plus. Tu peux tester le mode hors ligne sur ton mobile.'
