[CmdletBinding()]
param(
  [string]$InterfaceAlias = 'Wi-Fi',
  [Parameter(Mandatory = $true)]
  [string]$ExpectedNetworkName,
  [Parameter(Mandatory = $true)]
  [string]$NodePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

trap {
  Write-Host ''
  Write-Host 'La configuration LAN de Friday a échoué.' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host 'Appuyez sur Entrée pour fermer cette fenêtre' | Out-Null
  exit 1
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole(
  [System.Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdministrator) {
  $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $arguments = @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    "`"$PSCommandPath`"",
    '-InterfaceAlias',
    "`"$InterfaceAlias`"",
    '-ExpectedNetworkName',
    "`"$ExpectedNetworkName`"",
    '-NodePath',
    "`"$NodePath`""
  ) -join ' '
  Start-Process -FilePath $powershellPath -Verb RunAs -ArgumentList $arguments
  exit 0
}

$profile = Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias
if ($profile.Name -ne $ExpectedNetworkName) {
  throw "Réseau inattendu : '$($profile.Name)'. Configuration attendue : '$ExpectedNetworkName'."
}
if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Node.js est introuvable : $NodePath"
}

Set-NetConnectionProfile `
  -InterfaceAlias $InterfaceAlias `
  -NetworkCategory Private

$ruleName = 'Friday Hub HTTPS - réseau privé'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
  $existingRule | Remove-NetFirewallRule
}
New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description 'Autorise Friday sur TCP 8443 depuis le sous-réseau privé local.' `
  -Direction Inbound `
  -Action Allow `
  -Enabled True `
  -Profile Private `
  -Protocol TCP `
  -LocalPort 8443 `
  -RemoteAddress LocalSubnet `
  -Program $NodePath | Out-Null

$verifiedProfile = Get-NetConnectionProfile -InterfaceAlias $InterfaceAlias
$verifiedRule = Get-NetFirewallRule -DisplayName $ruleName
Write-Host ''
Write-Host 'Accès LAN Friday configuré.' -ForegroundColor Green
Write-Host "Réseau : $($verifiedProfile.Name) ($($verifiedProfile.NetworkCategory))"
Write-Host "Pare-feu : $($verifiedRule.DisplayName), profil Private, TCP 8443, LocalSubnet"
Read-Host 'Appuyez sur Entrée pour fermer cette fenêtre' | Out-Null
