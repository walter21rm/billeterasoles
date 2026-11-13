param(
  [string]$RepoUrl = "https://github.com/J0sePs/app-microservices-spec.git",
  [string]$Ref = "main",
  [string]$Region = "sa-east-1",
  [string]$EcrRepo = "withdrawal-soles",
  [string]$InstanceName = "billetera-soles"
)

$ErrorActionPreference = "Stop"
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$Root = Split-Path -Parent $PSScriptRoot

$Account = (aws sts get-caller-identity --query Account --output text 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Account)) {
  throw "AWS no tiene sesion. Ejecuta: aws login"
}
$Account = $Account.Trim()
$Registry = "$Account.dkr.ecr.$Region.amazonaws.com"
$Image = "$Registry/${EcrRepo}:local"

$InstanceId = (aws ec2 describe-instances `
  --filters Name=tag:Name,Values=$InstanceName Name=instance-state-name,Values=running `
  --query "Reservations[0].Instances[0].InstanceId" --output text).Trim()
if ($InstanceId -eq "None" -or [string]::IsNullOrWhiteSpace($InstanceId)) {
  throw "No hay una instancia running llamada $InstanceName. Primero ejecuta .\desplegar-aws.ps1"
}

$Work = Join-Path $env:TEMP "withdrawal-soles-src"
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
git clone --depth 1 --branch $Ref $RepoUrl $Work
if ($LASTEXITCODE -ne 0) { throw "No se pudo clonar $RepoUrl ($Ref)" }

Write-Output "Construyendo withdrawal-soles desde $Ref..."
docker build -t withdrawal-soles:local $Work
if ($LASTEXITCODE -ne 0) { throw "Fallo el build de retiros." }

$ErrorActionPreference = "Continue"
aws ecr describe-repositories --repository-names $EcrRepo *> $null
if ($LASTEXITCODE -ne 0) {
  aws ecr create-repository --repository-name $EcrRepo | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el repositorio ECR $EcrRepo." }
}
$ErrorActionPreference = "Stop"

$dockerConfigPath = Join-Path $env:USERPROFILE ".docker\config.json"
$utf8 = New-Object System.Text.UTF8Encoding $false
$dockerConfigBackup = [System.IO.File]::ReadAllText($dockerConfigPath)
try {
  $dockerConfig = $dockerConfigBackup | ConvertFrom-Json
  $dockerConfig.PSObject.Properties.Remove("credsStore")
  [System.IO.File]::WriteAllText($dockerConfigPath, ($dockerConfig | ConvertTo-Json -Depth 6), $utf8)
  $tokenFile = Join-Path $env:TEMP "withdrawal-ecr-token.txt"
  cmd /c "aws ecr get-login-password --region $Region > `"$tokenFile`""
  if ($LASTEXITCODE -ne 0) { throw "No se pudo obtener el token de ECR." }
  cmd /c "docker login --username AWS --password-stdin $Registry < `"$tokenFile`""
  Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { throw "Docker no pudo entrar a ECR." }
  docker tag withdrawal-soles:local $Image
  docker push $Image
  if ($LASTEXITCODE -ne 0) { throw "No se pudo subir la imagen de retiros." }
} finally {
  [System.IO.File]::WriteAllText($dockerConfigPath, $dockerConfigBackup, $utf8)
}

$yamlPath = Join-Path $env:TEMP "retiros-k8s.yaml"
& kubectl kustomize (Join-Path $Root "k8s\retiros") | Out-File -FilePath $yamlPath -Encoding utf8
$text = [System.IO.File]::ReadAllText($yamlPath)
if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
$text = $text -replace "`r", ""
[System.IO.File]::WriteAllText($yamlPath, $text, $utf8)
$encoded = [Convert]::ToBase64String($utf8.GetBytes($text))

$Remote = @"
set -euxo pipefail
PASS=`$(aws ecr get-login-password --region $Region)
k3s ctr images pull --user "AWS:`$PASS" $Image
k3s ctr images tag $Image docker.io/library/withdrawal-soles:local
mkdir -p /opt/billetera/k8s
printf '%s' '$encoded' | base64 -d > /opt/billetera/k8s/retiros.yaml
k3s kubectl apply -f /opt/billetera/k8s/retiros.yaml
k3s kubectl -n retiros rollout restart deploy/retiros-api deploy/retiros-dependencias
k3s kubectl -n retiros rollout status deploy/retiros-postgres --timeout=180s
k3s kubectl -n retiros rollout status deploy/retiros-dependencias --timeout=180s
k3s kubectl -n retiros rollout status deploy/retiros-api --timeout=240s
k3s kubectl -n retiros get pods
"@
$Remote = $Remote -replace "`r", ""
$ParamFile = Join-Path $PSScriptRoot "ssm-params-retiros.json"
@{ commands = @($Remote) } | ConvertTo-Json -Compress | Set-Content -Encoding ascii $ParamFile
$ParamUri = "file://" + (Resolve-Path $ParamFile).Path.Replace("\", "/")

Write-Output "Actualizando retiros en $InstanceId..."
$CommandId = (aws ssm send-command `
  --instance-ids $InstanceId `
  --document-name AWS-RunShellScript `
  --parameters $ParamUri `
  --query Command.CommandId --output text).Trim()

$Deadline = (Get-Date).AddMinutes(8)
do {
  Start-Sleep -Seconds 8
  $Status = (aws ssm get-command-invocation --command-id $CommandId --instance-id $InstanceId --query Status --output text 2>$null).Trim()
  Write-Output "STATUS $Status"
} while ($Status -in @("Pending", "InProgress", "Delayed") -and (Get-Date) -lt $Deadline)

aws ssm get-command-invocation --command-id $CommandId --instance-id $InstanceId --query StandardOutputContent --output text
if ($Status -ne "Success") {
  aws ssm get-command-invocation --command-id $CommandId --instance-id $InstanceId --query StandardErrorContent --output text
  throw "El redeploy de retiros no termino bien: $Status"
}

$Ip = (aws ec2 describe-instances --instance-ids $InstanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text).Trim()
Write-Output "Retiros actualizado."
Write-Output "URL http://${Ip}/api/v1/withdrawals"
