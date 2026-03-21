#!/bin/bash

# RPC Cluster Worker - Linux Installer
# Installs rpc-server and beacon as systemd services
#
# Usage:
#   sudo ./install.sh              Install / upgrade
#   sudo ./install.sh --uninstall  Remove everything

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="/usr/local/bin"
SYSTEMD_DIR="/etc/systemd/system"
CACHE_DIR="/var/cache/llama-rpc"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------- helpers ----------

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root (sudo).${NC}"
    exit 1
  fi
}

stop_services() {
  echo -e "${YELLOW}Stopping existing services (if running)...${NC}"
  systemctl stop rpc-cluster-rpcserver 2>/dev/null || true
  systemctl stop rpc-cluster-beacon   2>/dev/null || true
}

# ---------- uninstall ----------

uninstall() {
  check_root
  echo -e "${YELLOW}=== RPC Cluster Worker - Uninstall ===${NC}"

  stop_services

  echo -e "${YELLOW}Disabling services...${NC}"
  systemctl disable rpc-cluster-rpcserver 2>/dev/null || true
  systemctl disable rpc-cluster-beacon   2>/dev/null || true

  echo -e "${YELLOW}Removing unit files...${NC}"
  rm -f "$SYSTEMD_DIR/rpc-cluster-rpcserver.service"
  rm -f "$SYSTEMD_DIR/rpc-cluster-beacon.service"
  systemctl daemon-reload

  echo -e "${YELLOW}Removing binaries...${NC}"
  rm -f "$INSTALL_DIR/rpc-server"
  rm -f "$INSTALL_DIR/rpc-worker-beacon"

  echo -e "${YELLOW}Removing firewall rules (ufw)...${NC}"
  if command -v ufw &>/dev/null; then
    ufw delete allow 50052/tcp 2>/dev/null || true
    ufw delete allow 5005/udp  2>/dev/null || true
  fi

  echo ""
  echo -e "${GREEN}Uninstall complete.${NC}"
  echo "Note: Cache directory $CACHE_DIR was left in place. Remove manually if desired."
  exit 0
}

# ---------- install ----------

install() {
  check_root

  echo -e "${GREEN}=== RPC Cluster Worker - Linux Installer ===${NC}"

  # --- Locate binaries ---
  RPC_SERVER_SRC="$ROOT_DIR/vendor/linux/rpc-server"
  BEACON_SRC="$ROOT_DIR/worker-beacon/dist/rpc-worker-beacon-linux"

  if [ ! -f "$RPC_SERVER_SRC" ]; then
    echo -e "${RED}Error: rpc-server not found at: $RPC_SERVER_SRC${NC}"
    echo ""
    echo "Please download rpc-server from llama.cpp releases:"
    echo "  1. Visit: https://github.com/ggerganov/llama.cpp/releases"
    echo "  2. Download the linux-x64 archive"
    echo "  3. Extract rpc-server to: $ROOT_DIR/vendor/linux/"
    echo ""
    exit 1
  fi

  if [ ! -f "$BEACON_SRC" ]; then
    echo -e "${RED}Error: Worker beacon not found at: $BEACON_SRC${NC}"
    echo ""
    echo "Please build the beacon first:"
    echo "  cd $ROOT_DIR/worker-beacon"
    echo "  ./build.sh"
    echo ""
    exit 1
  fi

  echo -e "${GREEN}Found rpc-server and beacon binaries${NC}"

  # --- Stop existing services (upgrade path) ---
  stop_services

  # --- Copy binaries ---
  echo -e "${YELLOW}Installing binaries to $INSTALL_DIR ...${NC}"
  cp "$RPC_SERVER_SRC" "$INSTALL_DIR/rpc-server"
  cp "$BEACON_SRC"     "$INSTALL_DIR/rpc-worker-beacon"
  chmod +x "$INSTALL_DIR/rpc-server"
  chmod +x "$INSTALL_DIR/rpc-worker-beacon"

  # --- Cache directory ---
  echo -e "${YELLOW}Creating cache directory...${NC}"
  mkdir -p "$CACHE_DIR"
  chmod 755 "$CACHE_DIR"

  # --- Install systemd units ---
  echo -e "${YELLOW}Installing systemd services...${NC}"
  cp "$SCRIPT_DIR/rpc-cluster-rpcserver.service" "$SYSTEMD_DIR/"
  cp "$SCRIPT_DIR/rpc-cluster-beacon.service"    "$SYSTEMD_DIR/"
  chmod 644 "$SYSTEMD_DIR/rpc-cluster-rpcserver.service"
  chmod 644 "$SYSTEMD_DIR/rpc-cluster-beacon.service"

  systemctl daemon-reload

  # --- Firewall (ufw) ---
  if command -v ufw &>/dev/null; then
    echo -e "${YELLOW}Configuring firewall (ufw)...${NC}"
    ufw allow 50052/tcp comment "llama.cpp RPC server" >/dev/null 2>&1 || true
    ufw allow 5005/udp  comment "RPC Cluster discovery" >/dev/null 2>&1 || true
  else
    echo -e "${YELLOW}Note: ufw not found. Ensure TCP 50052 and UDP 5005 are open in your firewall.${NC}"
  fi

  # --- Enable and start ---
  echo -e "${YELLOW}Enabling and starting services...${NC}"
  systemctl enable rpc-cluster-rpcserver
  systemctl enable rpc-cluster-beacon
  systemctl start  rpc-cluster-rpcserver
  systemctl start  rpc-cluster-beacon

  # --- Verify ---
  sleep 2

  echo ""
  if systemctl is-active --quiet rpc-cluster-rpcserver; then
    echo -e "${GREEN}RPC server is running.${NC}"
  else
    echo -e "${YELLOW}Warning: RPC server may not have started. Check: journalctl -u rpc-cluster-rpcserver${NC}"
  fi

  if systemctl is-active --quiet rpc-cluster-beacon; then
    echo -e "${GREEN}Beacon is running.${NC}"
  else
    echo -e "${YELLOW}Warning: Beacon may not have started. Check: journalctl -u rpc-cluster-beacon${NC}"
  fi

  echo ""
  echo -e "${GREEN}=== Installation Complete ===${NC}"
  echo "Logs:      journalctl -u rpc-cluster-rpcserver -f"
  echo "           journalctl -u rpc-cluster-beacon -f"
  echo "Uninstall: sudo $0 --uninstall"
}

# ---------- entry point ----------

case "${1:-}" in
  --uninstall) uninstall ;;
  *)           install   ;;
esac
