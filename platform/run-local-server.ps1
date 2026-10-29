$ErrorActionPreference = 'Continue'
$Port = 8017
$RuleName = 'Python v oblakah Local Server 8017'
Set-Location -LiteralPath $PSScriptRoot

function Write-Banner {
    Write-Host ''
    Write-Host '========================================'
    Write-Host '  Python v oblakah - local LAN server'
    Write-Host '========================================'
    Write-Host ''
}

function Get-LanUrls {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -match '^192\.168\.' -and
            $_.InterfaceAlias -notmatch 'VPN|WSL|Hyper|Virtual|TAP|Tun|outline|Amnezia|Bluetooth'
        } |
        Select-Object -ExpandProperty IPAddress -Unique)

    if ($ips.Count -eq 0) {
        $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
                $_.InterfaceAlias -notmatch 'VPN|WSL|Hyper|Virtual|TAP|Tun|outline|Amnezia|Bluetooth'
            } |
            Select-Object -ExpandProperty IPAddress -Unique)
    }

    foreach ($ip in $ips) {
        "http://${ip}:$Port/"
    }
}

function Ensure-FirewallRule {
    $check = netsh advfirewall firewall show rule name="$RuleName" 2>&1 | Out-String
    if ($check -notmatch 'No rules match') {
        return $true
    }

    Write-Host "Adding firewall rule for port $Port..."
    $netshArgs = @(
        'advfirewall', 'firewall', 'add', 'rule',
        "name=$RuleName",
        'dir=in', 'action=allow', 'protocol=TCP',
        "localport=$Port",
        'profile=private,domain', 'enable=yes'
    )

    try {
        $proc = Start-Process -FilePath 'netsh' -ArgumentList $netshArgs -Verb RunAs -Wait -PassThru -ErrorAction Stop
        if ($proc.ExitCode -ne 0) {
            return $false
        }
    } catch {
        return $false
    }

    $check = netsh advfirewall firewall show rule name="$RuleName" 2>&1 | Out-String
    return ($check -notmatch 'No rules match')
}

function Get-PythonCommand {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @{ File = 'python'; Args = @('server.py') }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @{ File = 'py'; Args = @('-3', 'server.py') }
    }
    return $null
}

function Test-PortAvailable {
    param([int]$PortNumber)
    $listeners = @(Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        Write-Host "Port $PortNumber is occupied. Existing processes were left running."
        Write-Host 'Coordinate the update first; use python scripts/runtime_status.py.'
        return $false
    }
    return $true
}

Write-Banner

if (-not (Test-PortAvailable -PortNumber $Port)) {
    exit 1
}

if (Ensure-FirewallRule) {
    Write-Host '[OK] Firewall rule is ready.'
} else {
    Write-Host '[!] Firewall rule was not added.'
    Write-Host '    If LAN access fails, right-click run-local-server.bat -> Run as administrator.'
}
Write-Host ''

Write-Host 'On this computer:'
Write-Host "  http://localhost:$Port/"
Write-Host ''

Write-Host 'For colleague on LAN (same Wi-Fi / office network):'
$lanUrls = @(Get-LanUrls)
if ($lanUrls.Count -gt 0) {
    foreach ($url in $lanUrls) {
        Write-Host "  $url"
    }
} else {
    Write-Host '  [no LAN IP found — check Wi-Fi / Ethernet]'
}
Write-Host ''
Write-Host 'Stop server: Ctrl+C'
Write-Host ''

try {
    & (Join-Path $PSScriptRoot 'scripts/start_sandbox_wsl.ps1')
} catch {
    Write-Host 'Python sandbox is unavailable; code execution stays safely disabled.'
}
$python = Get-PythonCommand
if (-not $python) {
    Write-Host 'Error: Python not found. Install Python 3.12+ from python.org'
    exit 1
}

$server = Start-Process -FilePath $python.File -ArgumentList $python.Args -PassThru -NoNewWindow -WorkingDirectory $PSScriptRoot

if ($server.HasExited) {
    Write-Host 'Error: platform server failed to start.'
    exit 1
}

$healthOk = $false
$lastError = $null
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Milliseconds 400
    if ($server.HasExited) {
        Write-Host 'Error: platform server exited before becoming ready.'
        exit 1
    }
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $healthOk = $true
            break
        }
        $lastError = "server returned status $($response.StatusCode)"
    } catch {
        # health may 404 if missing — try root
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $healthOk = $true
                break
            }
            $lastError = "server returned status $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
    }
}

if (-not $healthOk) {
    Write-Host "Error: server health check failed: $lastError"
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host '[OK] Server is running.'
Write-Host ''
Start-Process "http://localhost:$Port/"
Wait-Process -Id $server.Id
