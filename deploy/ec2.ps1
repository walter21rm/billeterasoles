param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Continue"
$Region = "sa-east-1"
$Name = "billetera-soles"
$Repo = "billetera-api"
$Role = "billetera-ec2-role"
$Profile = "billetera-ec2-profile"
$Root = Split-Path -Parent $PSScriptRoot
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

function Invoke-Aws {
  $ErrorActionPreference = "Continue"
  & aws @args *> $null
  return [int]$LASTEXITCODE
}

function Ensure-Port([string]$GroupId, [int]$Port) {
  Invoke-Aws ec2 authorize-security-group-ingress --group-id $GroupId --protocol tcp --port $Port --cidr 0.0.0.0/0 | Out-Null
}

$Account = (aws sts get-caller-identity --query Account --output text 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Account)) {
  throw "AWS no tiene sesión. En una terminal ejecuta: aws login"
}
$Account = $Account.Trim()
$Registry = "$Account.dkr.ecr.$Region.amazonaws.com"
$Image = "$Registry/${Repo}:local"

$Running = (aws ec2 describe-instances --filters Name=tag:Name,Values=$Name Name=instance-state-name,Values=running --query "Reservations[0].Instances[0].PublicIpAddress" --output text 2>$null)
if (-not $Rebuild -and $Running -and $Running -ne "None") {
  try {
    $health = Invoke-WebRequest -Uri "http://${Running}/health" -UseBasicParsing -TimeoutSec 8
    if ($health.StatusCode -eq 200) {
      Write-Output "Ya está publicada. No reconstruyo ni creo otra instancia."
      Write-Output "URL http://${Running}"
      Start-Process "http://$Running"
      return
    }
  } catch {
    Write-Output "La instancia existe, pero la API no responde. La actualizo."
  }
}

docker image inspect billetera-api:local *> $null
$imageMissing = $LASTEXITCODE -ne 0
if ($Rebuild -or $imageMissing) {
  docker build -t billetera-api:local $Root
  if ($LASTEXITCODE -ne 0) { throw "Falló la construcción de la imagen." }
}

if ((Invoke-Aws ecr describe-repositories --repository-names $Repo) -ne 0) {
  aws ecr create-repository --repository-name $Repo | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el repositorio ECR." }
}

$HasImage = (aws ecr describe-images --repository-name $Repo --image-ids imageTag=local --query "length(imageDetails)" --output text 2>$null)
if ($Rebuild -or $HasImage -ne "1") {
  Write-Output "Subiendo la imagen a ECR..."
  $dockerConfigPath = Join-Path $env:USERPROFILE ".docker\config.json"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $dockerConfigBackup = [System.IO.File]::ReadAllText($dockerConfigPath)
  try {
    $dockerConfig = $dockerConfigBackup | ConvertFrom-Json
    $dockerConfig.PSObject.Properties.Remove("credsStore")
    $json = $dockerConfig | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($dockerConfigPath, $json, $utf8)
    $tokenFile = Join-Path $env:TEMP "billetera-ecr-token.txt"
    cmd /c "aws ecr get-login-password --region $Region > `"$tokenFile`""
    if ($LASTEXITCODE -ne 0) { throw "No se pudo obtener el token de ECR." }
    cmd /c "docker login --username AWS --password-stdin $Registry < `"$tokenFile`""
    Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { throw "Docker no pudo entrar a ECR." }
    docker tag billetera-api:local $Image
    docker push $Image
    if ($LASTEXITCODE -ne 0) { throw "No se pudo subir la imagen." }
  } finally {
    [System.IO.File]::WriteAllText($dockerConfigPath, $dockerConfigBackup, $utf8)
  }
} else {
  Write-Output "ECR ya tiene billetera-api:local. No la vuelvo a subir."
}

$TrustFile = (Resolve-Path "$PSScriptRoot\ec2-trust.json").Path.Replace("\", "/")
if ((Invoke-Aws iam get-role --role-name $Role) -ne 0) {
  aws iam create-role --role-name $Role --assume-role-policy-document "file://$TrustFile" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el rol." }
  aws iam attach-role-policy --role-name $Role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore | Out-Null
  aws iam attach-role-policy --role-name $Role --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly | Out-Null
}
if ((Invoke-Aws iam get-instance-profile --instance-profile-name $Profile) -ne 0) {
  aws iam create-instance-profile --instance-profile-name $Profile | Out-Null
}
$Attached = "$((aws iam get-instance-profile --instance-profile-name $Profile --query "InstanceProfile.Roles[].RoleName" --output text))".Trim()
if ($Attached -notmatch $Role) {
  aws iam add-role-to-instance-profile --instance-profile-name $Profile --role-name $Role | Out-Null
  Start-Sleep -Seconds 20
}

$Vpc = (aws ec2 describe-vpcs --filters Name=is-default,Values=true --query "Vpcs[0].VpcId" --output text).Trim()
$Subnet = (aws ec2 describe-subnets --filters Name=vpc-id,Values=$Vpc Name=map-public-ip-on-launch,Values=true --query "Subnets[0].SubnetId" --output text).Trim()
$Sg = (aws ec2 describe-security-groups --filters Name=group-name,Values=billetera-api Name=vpc-id,Values=$Vpc --query "SecurityGroups[0].GroupId" --output text).Trim()
if ($Sg -eq "None" -or [string]::IsNullOrWhiteSpace($Sg)) {
  $Sg = (aws ec2 create-security-group --group-name billetera-api --description "API de la billetera en soles" --vpc-id $Vpc --query GroupId --output text).Trim()
}
foreach ($Port in 80, 443, 30080) { Ensure-Port $Sg $Port }

$InstanceId = (aws ec2 describe-instances --filters Name=tag:Name,Values=$Name Name=instance-state-name,Values=pending,running --query "Reservations[0].Instances[0].InstanceId" --output text).Trim()
if ($InstanceId -eq "None" -or [string]::IsNullOrWhiteSpace($InstanceId)) {
  Write-Output "Creando la instancia t3.small..."
  $Ami = (aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text).Trim()
  $UserData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Raw "$PSScriptRoot\ec2-user-data.sh")))
  $InstanceId = (aws ec2 run-instances --image-id $Ami --instance-type t3.small --subnet-id $Subnet --security-group-ids $Sg --iam-instance-profile Name=$Profile --associate-public-ip-address --user-data $UserData --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$Name}]" --query "Instances[0].InstanceId" --output text).Trim()
}

aws ec2 wait instance-running --instance-ids $InstanceId
$Ip = (aws ec2 describe-instances --instance-ids $InstanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text).Trim()
Write-Output "INSTANCE $InstanceId"
Write-Output "PUBLIC_IP $Ip"

$Deadline = (Get-Date).AddMinutes(8)
do {
  Start-Sleep -Seconds 10
  $Ping = (aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$InstanceId" --query "InstanceInformationList[0].PingStatus" --output text).Trim()
} while ($Ping -ne "Online" -and (Get-Date) -lt $Deadline)
if ($Ping -ne "Online") { throw "La instancia no entró a Systems Manager. Revisa el rol billetera-ec2-role." }

$Files = @("namespace.yaml", "configmap.yaml", "secret.yaml", "postgres.yaml", "api.yaml", "ingress.yaml", "usuarios-ejemplo.yaml", "kustomization.yaml")
$Remote = @"
set -euxo pipefail
for i in `$(seq 1 40); do k3s kubectl get nodes && break; sleep 5; done
PASS=`$(aws ecr get-login-password --region $Region)
k3s ctr images pull --user "AWS:`$PASS" $Image
k3s ctr images tag $Image docker.io/library/billetera-api:local
mkdir -p /opt/billetera/k8s
"@
foreach ($File in $Files) {
  $bytes = [Text.Encoding]::UTF8.GetBytes((Get-Content -Raw (Join-Path $Root "k8s\$File")))
  $encoded = [Convert]::ToBase64String($bytes)
  $Remote += "`nprintf '%s' '$encoded' | base64 -d > /opt/billetera/k8s/$File"
}
$Remote += @"

k3s kubectl apply -k /opt/billetera/k8s
k3s kubectl -n billetera rollout restart deploy/billetera-api
k3s kubectl -n billetera rollout status deploy/billetera-postgres --timeout=180s
k3s kubectl -n billetera rollout status deploy/billetera-api --timeout=240s
curl -fsS http://127.0.0.1:30080/health
"@

$Remote = $Remote -replace "`r", ""
$ParamFile = Join-Path $PSScriptRoot "ssm-params.json"
@{ commands = @($Remote) } | ConvertTo-Json -Compress | Set-Content -Encoding ascii $ParamFile
$ParamUri = "file://" + (Resolve-Path $ParamFile).Path.Replace("\", "/")
$CommandId = (aws ssm send-command --instance-ids $InstanceId --document-name AWS-RunShellScript --parameters $ParamUri --query Command.CommandId --output text).Trim()
aws ssm wait command-executed --command-id $CommandId --instance-id $InstanceId
aws ssm get-command-invocation --command-id $CommandId --instance-id $InstanceId --query StandardOutputContent --output text
Write-Output "URL http://${Ip}"
Start-Process "http://$Ip"
