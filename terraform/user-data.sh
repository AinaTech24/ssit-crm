#!/bin/bash
# Cloud-init: install Docker + the compose plugin on first boot. The actual app
# deploy (clone, build, migrate, up) is driven over SSH so failures are visible.
set -euxo pipefail

dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user

# Docker Compose v2 plugin (ARM64 build).
ARCH="$(uname -m)"
mkdir -p /usr/libexec/docker/cli-plugins
curl -sSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

echo "cloud-init complete" > /var/log/mfd-bootstrap.done
