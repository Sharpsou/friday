[CmdletBinding()]
param(
  [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$launcherPath = Join-Path $PSScriptRoot 'Start-FridayRecipe.ps1'
$stopLauncherPath = Join-Path $PSScriptRoot 'Stop-Friday.ps1'
$lanConfigurationPath = Join-Path $PSScriptRoot 'Configure-FridayLan.ps1'
if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "Lanceur Friday introuvable : $launcherPath"
}
if (-not (Test-Path -LiteralPath $stopLauncherPath)) {
  throw "Arret Friday introuvable : $stopLauncherPath"
}
if (-not (Test-Path -LiteralPath $lanConfigurationPath)) {
  throw "Configuration LAN Friday introuvable : $lanConfigurationPath"
}

if (-not (Test-Path -LiteralPath $DesktopPath)) {
  New-Item -ItemType Directory -Path $DesktopPath -Force | Out-Null
}

$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$shortcutPath = Join-Path $DesktopPath 'Friday - Lancer et recetter.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $workspacePath
$shortcut.Description = 'Construire, lancer et recetter Friday dans Google Chrome'
$shortcut.IconLocation = "$powershellPath,0"
$shortcut.Save()

$backgroundShortcutPath = Join-Path $DesktopPath 'Friday - Lancer ou redemarrer.lnk'
$backgroundShortcut = $shell.CreateShortcut($backgroundShortcutPath)
$backgroundShortcut.TargetPath = $powershellPath
$backgroundShortcut.Arguments = (
  "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass " +
  "-File `"$launcherPath`" -NoBrowser -ExitAfterHealthCheck " +
  '-RestartExisting -KeepHubRunning -ShowStatusPopup'
)
$backgroundShortcut.WorkingDirectory = $workspacePath
$backgroundShortcut.Description = 'Construire puis lancer ou redemarrer Friday en arriere-plan'
$backgroundShortcut.IconLocation = "$powershellPath,0"
$backgroundShortcut.WindowStyle = 7
$backgroundShortcut.Save()

$stopShortcutPath = Join-Path $DesktopPath 'Friday - Arreter le service.lnk'
$stopShortcut = $shell.CreateShortcut($stopShortcutPath)
$stopShortcut.TargetPath = $powershellPath
$stopShortcut.Arguments = (
  "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass " +
  "-File `"$stopLauncherPath`""
)
$stopShortcut.WorkingDirectory = $workspacePath
$stopShortcut.Description = 'Arreter Friday pour tester le mode hors ligne'
$stopShortcut.IconLocation = "$powershellPath,0"
$stopShortcut.WindowStyle = 7
$stopShortcut.Save()

$networkConfiguration = Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1
if (-not $networkConfiguration) {
  throw 'Aucune interface réseau active avec passerelle n’a été trouvée.'
}
$networkProfile = Get-NetConnectionProfile `
  -InterfaceIndex $networkConfiguration.InterfaceIndex
$nodePath = (Get-Command node -ErrorAction Stop).Source
$lanShortcutPath = Join-Path $DesktopPath 'Friday - Configurer acces A17.lnk'
$lanShortcut = $shell.CreateShortcut($lanShortcutPath)
$lanShortcut.TargetPath = $powershellPath
$lanShortcut.Arguments = (
  "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$lanConfigurationPath`" " +
  "-InterfaceAlias `"$($networkConfiguration.InterfaceAlias)`" " +
  "-ExpectedNetworkName `"$($networkProfile.Name)`" " +
  "-NodePath `"$nodePath`""
)
$lanShortcut.WorkingDirectory = $workspacePath
$lanShortcut.Description = 'Configurer le réseau privé et le pare-feu pour le Galaxy A17'
$lanShortcut.IconLocation = "$powershellPath,0"
$lanShortcut.Save()

Write-Output "SHORTCUT_PATH=$shortcutPath"
Write-Output "BACKGROUND_SHORTCUT_PATH=$backgroundShortcutPath"
Write-Output "STOP_SHORTCUT_PATH=$stopShortcutPath"
Write-Output "LAN_SHORTCUT_PATH=$lanShortcutPath"
