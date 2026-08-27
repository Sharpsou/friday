[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8443
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-FridayStatus {
  param([Parameter(Mandatory = $true)][string]$Message)

  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.Popup($Message, 5, 'Friday', 64)
}

$isRunning = $false

try {
  $workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $hubEntryPoint = Join-Path $workspacePath 'apps\hub\dist\main.js'
  $listenerProcessIds = @(
    Get-NetTCPConnection `
      -LocalPort $Port `
      -State Listen `
      -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )

  foreach ($listenerProcessId in $listenerProcessIds) {
    $listenerProcess = Get-CimInstance `
      Win32_Process `
      -Filter "ProcessId=$listenerProcessId" `
      -ErrorAction SilentlyContinue
    $isFridayHub =
      $listenerProcess -and
      $listenerProcess.Name -eq 'node.exe' -and
      $listenerProcess.CommandLine -and
      $listenerProcess.CommandLine.IndexOf(
        $hubEntryPoint,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -ge 0

    if ($isFridayHub) {
      $isRunning = $true
      break
    }
  }
}
catch {
  $isRunning = $false
}

if ($isRunning) {
  Show-FridayStatus 'Friday tourne.'
}
else {
  Show-FridayStatus 'Friday ne tourne pas.'
}
