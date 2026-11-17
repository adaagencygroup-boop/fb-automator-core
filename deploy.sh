#!/bin/bash
set -e
if ! grep -q "8.8.8.8" /etc/resolv.conf 2>/dev/null; then
  echo "nameserver 8.8.8.8" >> /etc/resolv.conf 2>/dev/null || true
fi
swapExists=$(swapon --show 2>/dev/null | wc -l)
if [ "$swapExists" -le 1 ]; then
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  else
    dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi
if command -v sysctl >/dev/null 2>&1; then
  sysctl -w vm.overcommit_memory=1 >/dev/null 2>&1 || true
  sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true
  sysctl -w net.ipv6.conf.lo.disable_ipv6=1 >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow 9000/tcp >/dev/null 2>&1 || true
  ufw allow 5432/tcp >/dev/null 2>&1 || true
fi
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com/ | sh
  systemctl enable --now docker
fi
mkdir -p /etc/docker
echo '{"dns":["8.8.8.8","1.1.1.1"],"ipv6":false,"max-concurrent-downloads":2}' > /etc/docker/daemon.json
systemctl restart docker
if ! docker compose version >/dev/null 2>&1; then
  apt-get update && apt-get install -y docker-compose-plugin 2>/dev/null || true
fi
docker compose build --parallel=false
docker compose up -d
docker compose ps