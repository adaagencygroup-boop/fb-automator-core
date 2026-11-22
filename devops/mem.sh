#!/bin/bash
set -e

docker system prune -a -f
sudo sync && echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null
free -h
df -h