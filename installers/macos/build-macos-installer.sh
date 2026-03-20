#!/bin/bash

# RPC Cluster Worker - macOS Installer Build Script
# Builds a .pkg installer using Apple's native pkgbuild and productbuild tools
# Requires: Xcode Command Line Tools (xcode-select --install)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== RPC Cluster Worker - macOS Installer Build ===${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/macos"
BEACON_PATH="$ROOT_DIR/worker-beacon/dist/rpc-worker-beacon-macos"
DIST_DIR="$ROOT_DIR/dist"

# Version
VERSION="0.1.0"
IDENTIFIER="com.rpccluster.worker"
MIN_OS="13.0"

# Check for required tools
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v pkgbuild &> /dev/null; then
    echo -e "${RED}Error: pkgbuild not found. Install Xcode Command Line Tools:${NC}"
    echo "  xcode-select --install"
    exit 1
fi

if ! command -v productbuild &> /dev/null; then
    echo -e "${RED}Error: productbuild not found. Install Xcode Command Line Tools:${NC}"
    echo "  xcode-select --install"
    exit 1
fi

echo -e "${GREEN}Found pkgbuild and productbuild${NC}"

# Check for vendor binaries
echo -e "${YELLOW}Checking for vendor binaries...${NC}"

RPC_SERVER_PATH="$VENDOR_DIR/rpc-server"
if [ ! -f "$RPC_SERVER_PATH" ]; then
    echo -e "${RED}Error: rpc-server not found at: $RPC_SERVER_PATH${NC}"
    echo ""
    echo "Please download rpc-server from llama.cpp releases:"
    echo "  1. Visit: https://github.com/ggerganov/llama.cpp/releases"
    echo "  2. Download: llama-<version>-bin-macos-arm64.zip (Apple Silicon)"
    echo "     or: llama-<version>-bin-macos-x64.zip (Intel)"
    echo "  3. Extract rpc-server to: $VENDOR_DIR/"
    echo ""
    exit 1
fi

echo -e "${GREEN}Found rpc-server${NC}"

# Check for beacon
if [ ! -f "$BEACON_PATH" ]; then
    echo -e "${RED}Error: Worker beacon not found at: $BEACON_PATH${NC}"
    echo ""
    echo "Please build the beacon first:"
    echo "  cd $ROOT_DIR/worker-beacon"
    echo "  ./build.sh"
    echo ""
    exit 1
fi

echo -e "${GREEN}Found beacon executable${NC}"

# Create build directories
BUILD_DIR="$SCRIPT_DIR/build"
PAYLOAD_DIR="$BUILD_DIR/payload"
SCRIPTS_DIR="$BUILD_DIR/scripts"

rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD_DIR/usr/local/bin"
mkdir -p "$PAYLOAD_DIR/Library/LaunchDaemons"
mkdir -p "$PAYLOAD_DIR/var/cache/llama-rpc"
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$DIST_DIR"

echo -e "${YELLOW}Assembling payload...${NC}"

# Copy binaries
cp "$RPC_SERVER_PATH" "$PAYLOAD_DIR/usr/local/bin/rpc-server"
cp "$BEACON_PATH" "$PAYLOAD_DIR/usr/local/bin/rpc-worker-beacon"
chmod +x "$PAYLOAD_DIR/usr/local/bin/rpc-server"
chmod +x "$PAYLOAD_DIR/usr/local/bin/rpc-worker-beacon"

# Copy LaunchDaemon plists
cp "$SCRIPT_DIR/launchd/com.rpccluster.rpcserver.plist" "$PAYLOAD_DIR/Library/LaunchDaemons/"
cp "$SCRIPT_DIR/launchd/com.rpccluster.beacon.plist" "$PAYLOAD_DIR/Library/LaunchDaemons/"

# Copy scripts
cp "$SCRIPT_DIR/scripts/preinstall" "$SCRIPTS_DIR/"
cp "$SCRIPT_DIR/scripts/postinstall" "$SCRIPTS_DIR/"
chmod +x "$SCRIPTS_DIR/preinstall"
chmod +x "$SCRIPTS_DIR/postinstall"

echo -e "${GREEN}Payload assembled${NC}"

# Build component package
echo -e "${YELLOW}Building component package...${NC}"

COMPONENT_PKG="$BUILD_DIR/rpc-cluster-worker-component.pkg"

pkgbuild \
    --root "$PAYLOAD_DIR" \
    --scripts "$SCRIPTS_DIR" \
    --identifier "$IDENTIFIER" \
    --version "$VERSION" \
    --install-location "/" \
    "$COMPONENT_PKG"

echo -e "${GREEN}Component package built${NC}"

# Build product package
echo -e "${YELLOW}Building product package...${NC}"

OUTPUT_PKG="$DIST_DIR/rpc-cluster-worker-$VERSION-macos.pkg"

# Check for signing identity
SIGN_ARGS=""
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    echo -e "${YELLOW}Signing with identity: $APPLE_SIGNING_IDENTITY${NC}"
    SIGN_ARGS="--sign \"$APPLE_SIGNING_IDENTITY\""
else
    echo -e "${YELLOW}Warning: APPLE_SIGNING_IDENTITY not set. Building unsigned package.${NC}"
    echo "To sign the package, set APPLE_SIGNING_IDENTITY to your Developer ID Installer certificate name."
fi

# Use Distribution.xml for customized installer
productbuild \
    --distribution "$SCRIPT_DIR/Distribution.xml" \
    --package-path "$BUILD_DIR" \
    --resources "$SCRIPT_DIR" \
    $SIGN_ARGS \
    "$OUTPUT_PKG"

echo -e "${GREEN}Product package built${NC}"

# Cleanup
echo -e "${YELLOW}Cleaning up build directory...${NC}"
rm -rf "$BUILD_DIR"

# Print output info
echo ""
echo -e "${GREEN}=== Build Complete ===${NC}"
echo "Output: $OUTPUT_PKG"
echo "Size: $(du -h "$OUTPUT_PKG" | cut -f1)"

if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
    echo ""
    echo -e "${YELLOW}Note: Package is unsigned. Users may need to allow installation in System Preferences.${NC}"
    echo "To create a signed package, set APPLE_SIGNING_IDENTITY environment variable."
fi

# Optional: Create DMG wrapper
if command -v create-dmg &> /dev/null && [ "$CREATE_DMG" = "true" ]; then
    echo ""
    echo -e "${YELLOW}Creating DMG wrapper...${NC}"
    
    DMG_OUTPUT="$DIST_DIR/rpc-cluster-worker-$VERSION-macos.dmg"
    
    create-dmg \
        --volname "RPC Cluster Worker" \
        --window-size 600 400 \
        --icon-size 100 \
        --app-drop-link 450 200 \
        "$DMG_OUTPUT" \
        "$OUTPUT_PKG"
    
    echo -e "${GREEN}DMG created: $DMG_OUTPUT${NC}"
fi
