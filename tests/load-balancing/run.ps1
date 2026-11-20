param(
    [string]$Caddy = 'caddy',
    [switch]$Serve
)

$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot '../../backend'
$python = Join-Path $backend '.venv/Scripts/python.exe'
$caddyExe = (Get-Command $Caddy -CommandType Application).Source
$processes = @()

function Start-Api([int]$Port) {
    Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru -ArgumentList @(
        '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port"
    )
}

function Invoke-Probe([int]$Port) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/health"
        $instance = ($response.Headers['X-Backend-Instance'] -join '') -replace '^tcp/', ''
        if (-not $instance) { $instance = "direct:$Port" }
        [pscustomobject]@{ Instance = $instance; Status = [int]$response.StatusCode; Ms = $timer.Elapsed.TotalMilliseconds }
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        [pscustomobject]@{ Instance = 'unavailable'; Status = $status; Ms = $timer.Elapsed.TotalMilliseconds }
    }
}

function Wait-ForHealth([int]$Port, [System.Diagnostics.Process]$Process) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($Process.HasExited) { throw "Process for port $Port exited before becoming ready." }
        if ((Invoke-Probe $Port).Status -eq 200) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for port $Port."
}

function Stop-LabProcess([System.Diagnostics.Process]$Process) {
    if (-not $Process.HasExited) {
        Stop-Process -InputObject $Process
        if (-not $Process.WaitForExit(5000)) { throw "Could not stop lab process $($Process.Id)." }
    }
}

function Measure-Phase([string]$Label, [int]$Port, [int]$Count, [int]$DelayMs = 0) {
    $samples = for ($i = 0; $i -lt $Count; $i++) {
        Invoke-Probe $Port
        if ($DelayMs) { Start-Sleep -Milliseconds $DelayMs }
    }
    $distribution = ($samples | Group-Object Instance, Status | ForEach-Object { "$($_.Name): $($_.Count)" }) -join '; '
    Write-Host "$Label ($Count requests) - $distribution"
    $times = @($samples | Where-Object Status -EQ 200 | Select-Object -ExpandProperty Ms | Sort-Object)
    if ($times.Count) {
        $middle = [int][math]::Floor($times.Count / 2)
        $median = if ($times.Count % 2) { $times[$middle] } else { ($times[$middle - 1] + $times[$middle]) / 2 }
        $p95 = $times[[int][math]::Ceiling(0.95 * $times.Count) - 1]
        Write-Host ('  successful requests: median {0:N1} ms, p95 {1:N1} ms' -f $median, $p95)
    }
    $samples
}

function Assert-Routes($Samples, [string[]]$Expected) {
    $actual = @($Samples | Where-Object Status -EQ 200 | Select-Object -ExpandProperty Instance -Unique | Sort-Object)
    if (@($Samples | Where-Object Status -NE 200).Count -or (($actual -join ',') -ne ($Expected -join ','))) {
        throw "Expected successful responses from $($Expected -join ' and ')."
    }
}

if (-not (Test-Path -LiteralPath $python)) { throw 'Set up the backend .venv first.' }
foreach ($port in 8001, 8002, 8080) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    try { $listener.Start() }
    catch { throw "Port $port is already in use." }
    finally { $listener.Stop() }
}

try {
    $apiA = Start-Api 8001
    $processes += $apiA
    $apiB = Start-Api 8002
    $processes += $apiB
    Wait-ForHealth 8001 $apiA
    Wait-ForHealth 8002 $apiB
    $balancer = Start-Process -FilePath $caddyExe -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -ArgumentList @(
        'run', '--config', 'Caddyfile'
    )
    $processes += $balancer
    Wait-ForHealth 8080 $balancer

    if ($Serve) {
        Write-Host 'API balancer: http://127.0.0.1:8080'
        Write-Host 'Start the frontend in a separate terminal. Press Ctrl+C here to stop the lab.'
        while (-not $balancer.HasExited) { Start-Sleep -Seconds 1 }
        throw 'Caddy exited while serving the lab.'
    }

    Assert-Routes (Measure-Phase 'Direct A' 8001 20) 'direct:8001'
    Assert-Routes (Measure-Phase 'Direct B' 8002 20) 'direct:8002'
    $both = @('127.0.0.1:8001', '127.0.0.1:8002')
    Assert-Routes (Measure-Phase 'Balanced' 8080 40) $both
    Stop-LabProcess $apiB
    Measure-Phase 'Failover window' 8080 10 500 | Out-Null
    Assert-Routes (Measure-Phase 'A only' 8080 20) '127.0.0.1:8001'
    $apiB = Start-Api 8002
    $processes += $apiB
    Wait-ForHealth 8002 $apiB
    Start-Sleep -Seconds 3
    Assert-Routes (Measure-Phase 'B restored' 8080 40) $both
} finally {
    foreach ($process in $processes) {
        try { Stop-LabProcess $process }
        catch { Write-Warning $_.Exception.Message }
    }
}
