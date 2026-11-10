#!/bin/bash
set -euxo pipefail
dnf install -y awscli-2
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -
for _ in $(seq 1 40); do
  k3s kubectl get nodes && exit 0
  sleep 5
done
exit 1
