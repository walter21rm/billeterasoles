param(
  [switch]$Rebuild
)

& "$PSScriptRoot\deploy\ec2.ps1" -Rebuild:$Rebuild
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
