# Dual-run launcher: Flask API/vanilla on :8017 + Vite React on :8018.
# Owns only processes this script starts; Ctrl+C cleans them up.
$ErrorActionPreference = 'Stop'
$FlaskPort = 8017
$VitePort = 8018
Set-Location -LiteralPath $PSScriptRoot

$ownedFlask = $false
$flaskProc = $null
$viteProc = $null

function Test-HttpOk {
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    } catch {
        return $false
    }
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

function Stop-OwnedProcess {
    param($Process)
    if (-not $Process) { return }
    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            # Kill child tree on Windows when possible
            & taskkill /PID $Process.Id /T /F 2>$null | Out-Null
        }
    } catch {
        # already gone
    }
}

function Cleanup {
    Write-Host ''
    Write-Host 'Stopping owned dual-run processes...'
    Stop-OwnedProcess $viteProc
    if ($ownedFlask) {
        Stop-OwnedProcess $flaskProc
    } else {
        Write-Host 'Flask was already running — left untouched.'
    }
}

$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    # best-effort; primary cleanup is in finally
} | Out-Null

try {
    Write-Host ''
    Write-Host '========================================'
    Write-Host '  Python v oblakah - React dual-run'
    Write-Host '========================================'
    Write-Host ''

    $healthUrl = "http://127.0.0.1:${FlaskPort}/api/health"
    if (Test-HttpOk $healthUrl) {
        Write-Host "Flask already healthy on :$FlaskPort"
    } else {
        $py = Get-PythonCommand
        if (-not $py) {
            throw 'Python not found (python or py). Start Flask manually on :8017 or install Python.'
        }
        Write-Host "Starting Flask on :$FlaskPort (owned by this script)..."
        $flaskProc = Start-Process -FilePath $py.File -ArgumentList $py.Args `
            -WorkingDirectory $PSScriptRoot `
            -PassThru -WindowStyle Hidden
        $ownedFlask = $true

        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            if (Test-HttpOk $healthUrl) { break }
            Start-Sleep -Milliseconds 400
        }
        if (-not (Test-HttpOk $healthUrl)) {
            throw "Flask did not become healthy at $healthUrl"
        }
        Write-Host 'Flask is ready.'
    }

    $frontendRel = Join-Path $PSScriptRoot 'frontend'
    if (-not (Test-Path -LiteralPath (Join-Path $frontendRel 'package.json'))) {
        throw "Missing frontend app at $frontendRel"
    }
    # Vite dep-optimizer crashes when cwd is a Windows junction/symlink mirror.
    # Always run from the real filesystem path (e.g. D:\Backup_E\...).
    $frontendDir = (& node -p "require('fs').realpathSync(process.argv[1])" $frontendRel).Trim()
    if (-not $frontendDir -or -not (Test-Path -LiteralPath $frontendDir)) {
        throw "Could not resolve real path for frontend ($frontendRel)"
    }

    Write-Host "Starting Vite on :$VitePort (cwd=$frontendDir)..."
    $viteProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'npm', 'run', 'dev') `
        -WorkingDirectory $frontendDir `
        -PassThru -NoNewWindow

    $viteUrl = "http://127.0.0.1:${VitePort}/"
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($viteProc.HasExited) {
            throw "Vite exited early with code $($viteProc.ExitCode)"
        }
        if (Test-HttpOk $viteUrl) { break }
        Start-Sleep -Milliseconds 400
    }
    if (-not (Test-HttpOk $viteUrl)) {
        throw "Vite did not become ready at $viteUrl"
    }

    Write-Host ''
    Write-Host 'Dual-run ready:'
    Write-Host "  Vanilla (legacy): http://127.0.0.1:${FlaskPort}/"
    Write-Host "  React (Vite):     http://127.0.0.1:${VitePort}/"
    Write-Host ''
    Write-Host 'Press Ctrl+C to stop owned processes.'
    Write-Host ''

    while (-not $viteProc.HasExited) {
        Start-Sleep -Seconds 1
    }
    if ($viteProc.ExitCode -ne 0) {
        throw "Vite exited with code $($viteProc.ExitCode)"
    }
}
catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Cleanup
}
