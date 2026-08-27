[CmdletBinding()]
param(
  [string]$RobotHost = '192.168.1.22',
  [string]$RobotUser = 'pi',
  [string]$KeyPath = 'D:\FridayData\robot\ssh\alphabot2_runtime_v3_ed25519'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "Clé SSH introuvable : $KeyPath"
}

$host.UI.RawUI.WindowTitle = 'Friday Pi - installation veille réseau'
Write-Host 'Le robot doit être immobile, roues et servos désactivés.'
Write-Host 'Saisissez le mot de passe sudo du compte pi quand il est demandé.'
Write-Host ''

$remoteCommand = @'
if sudo sh /home/pi/friday-robot/deploy/install-network-standby.sh; then
  printf success > /home/pi/friday-standby-install.result
  echo INSTALLATION_OK
else
  printf failed > /home/pi/friday-standby-install.result
  echo INSTALLATION_ECHEC
  exit 1
fi
'@

& ssh.exe -tt -i $KeyPath "$RobotUser@$RobotHost" $remoteCommand
$exitCode = $LASTEXITCODE
Write-Host ''
if ($exitCode -eq 0) {
  Write-Host 'Installation terminée. Codex va maintenant vérifier les services.' -ForegroundColor Green
}
else {
  Write-Host "Installation interrompue (code $exitCode). Laissez cette fenêtre ouverte pour diagnostic." -ForegroundColor Red
}
