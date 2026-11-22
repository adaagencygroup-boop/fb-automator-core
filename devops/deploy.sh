#!/bin/bash
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$dir/.."
if [ ! -f .env ]; then
  echo "Missing .env File In $(pwd)"
  exit 1
fi
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
if ! grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
  echo "nameserver 8.8.8.8" >> /etc/resolv.conf 2>/dev/null || true
fi
if command -v sysctl >/dev/null 2>&1; then
  sysctl -w vm.overcommit_memory=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.lo.disable_ipv6=1 >/dev/null 2>&1 || true
fi
if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y -qq --no-install-recommends ca-certificates curl git ufw gnupg lsb-release
  apt-get autoremove -y && apt-get clean
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow 5432/tcp >/dev/null 2>&1 || true
fi
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com/ | sh
  systemctl enable --now docker
fi
cfg='{"dns":["8.8.8.8","1.1.1.1"],"ipv6":false,"max-concurrent-downloads":2}'
if [ ! -f /etc/docker/daemon.json ] || [ "$(cat /etc/docker/daemon.json)" != "$cfg" ]; then
  mkdir -p /etc/docker
  echo "$cfg" > /etc/docker/daemon.json
  systemctl restart docker
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
  apt-get clean
fi
docker compose build --parallel=false
docker compose up -d --remove-orphans
docker compose ps