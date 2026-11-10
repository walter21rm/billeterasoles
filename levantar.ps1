param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Kind = Join-Path $env:LOCALAPPDATA "kind.exe"
if (-not (Test-Path $Kind)) {
  $Kind = (Get-Command kind -ErrorAction SilentlyContinue).Source
}
if (-not $Kind) { throw "No está kind. Instálalo o vuelve a crearlo en $env:LOCALAPPDATA\kind.exe" }

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-Http([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (Test-Http $Url) { return $true }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $desktop = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"
  if (Test-Path $desktop) { Start-Process $desktop }
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 3
    docker info *> $null
  } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw "Docker no arrancó." }
}

$clusters = & $Kind get clusters
if ($clusters -notcontains "billetera") {
  Write-Output "Creando el clúster (solo la primera vez)..."
  & $Kind create cluster --config (Join-Path $Root "k8s\kind-config.yaml")
  $Rebuild = $true
}
kubectl config use-context kind-billetera | Out-Null

$apiUp = Test-Http "http://127.0.0.1:30080/health"
if ($Rebuild -or -not $apiUp) {
  Write-Output "Construyendo y cargando la imagen..."
  docker build -t billetera-api:local $Root
  if ($LASTEXITCODE -ne 0) { throw "Falló la imagen." }
  & $Kind load docker-image billetera-api:local --name billetera
  kubectl apply -k (Join-Path $Root "k8s")
  kubectl -n billetera rollout status deploy/billetera-postgres --timeout=180s
  kubectl -n billetera rollout restart deploy/billetera-api | Out-Null
  kubectl -n billetera rollout status deploy/billetera-api --timeout=180s
} else {
  Write-Output "La API ya responde. No reconstruyo la imagen."
}

if (-not (Test-Http "http://localhost:5173/")) {
  Write-Output "Arrancando la pantalla..."
  Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory (Join-Path $Root "web") -WindowStyle Minimized
  if (-not (Wait-Http "http://localhost:5173/" 40)) { throw "La pantalla no abrió en el puerto 5173." }
} else {
  Write-Output "La pantalla ya estaba abierta."
}

Start-Process "http://localhost:5173/"
Write-Output "Listo."
Write-Output "Pantalla  http://localhost:5173/"
Write-Output "API       http://127.0.0.1:30080/"
