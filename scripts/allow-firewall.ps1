# WrapDrive — allow LAN discovery and transfers through Windows Firewall.
#
# Windows blocks inbound connections to the WrapDrive server (port 53317) by
# default, especially on "Public" networks, so other devices on your Wi-Fi
# cannot find or reach this machine. Run this script ONCE as Administrator:
#
#   Right-click -> "Run with PowerShell" as Administrator, or from an elevated
#   PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\allow-firewall.ps1
#
# To remove the rules later:  scripts\allow-firewall.ps1 -Remove

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$port = 53317
$tcpName = 'WrapDrive LAN (TCP 53317)'
$udpName = 'WrapDrive LAN (UDP 53317)'

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host 'This script must be run as Administrator.' -ForegroundColor Red
    Write-Host 'Right-click PowerShell and choose "Run as administrator", then re-run.'
    exit 1
}

if ($Remove) {
    Get-NetFirewallRule -DisplayName $tcpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Get-NetFirewallRule -DisplayName $udpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'WrapDrive firewall rules removed.' -ForegroundColor Green
    exit 0
}

# Recreate cleanly (idempotent).
Get-NetFirewallRule -DisplayName $tcpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName $udpName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName $tcpName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $port -Profile Any | Out-Null
New-NetFirewallRule -DisplayName $udpName -Direction Inbound -Action Allow `
    -Protocol UDP -LocalPort $port -Profile Any | Out-Null

Write-Host "Allowed inbound TCP+UDP on port $port for WrapDrive." -ForegroundColor Green
Write-Host 'Your phone and other LAN devices can now reach this machine.'
