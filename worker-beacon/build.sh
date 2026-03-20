#!/bin/bash

# RPC Cluster Worker Beacon Build Script
# Builds standalone executables for Windows and macOS using Node.js SEA

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== RPC Worker Beacon Build ===${NC}"

# Create dist directory
mkdir -p dist

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo -e "${RED}Error: Node.js 22 or later is required for SEA support${NC}"
    echo "Current version: $(node -v)"
    exit 1
fi

echo -e "${GREEN}Node.js version: $(node -v)${NC}"

# Detect current platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo -e "${YELLOW}Building for platform: $PLATFORM ($ARCH)${NC}"

# Generate the SEA blob
echo -e "${YELLOW}Generating SEA blob...${NC}"
node --experimental-sea-config sea-config.json

if [ ! -f "sea-prep.blob" ]; then
    echo -e "${RED}Error: Failed to generate SEA blob${NC}"
    exit 1
fi

echo -e "${GREEN}SEA blob generated successfully${NC}"

# Build for current platform
build_current_platform() {
    if [ "$PLATFORM" = "darwin" ]; then
        build_macos
    elif [ "$PLATFORM" = "linux" ]; then
        # Linux build (for testing in CI)
        build_linux
    else
        echo -e "${YELLOW}Skipping native build on $PLATFORM${NC}"
    fi
}

# Build macOS binary
build_macos() {
    echo -e "${YELLOW}Building macOS binary...${NC}"
    
    # Copy Node.js binary
    NODE_PATH=$(which node)
    cp "$NODE_PATH" dist/rpc-worker-beacon-macos
    
    # Inject the SEA blob
    npx postject dist/rpc-worker-beacon-macos NODE_SEA_BLOB sea-prep.blob \
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
        --macho-segment-name NODE_SEA
    
    # Remove code signature (required on macOS)
    codesign --remove-signature dist/rpc-worker-beacon-macos 2>/dev/null || true
    
    # Make executable
    chmod +x dist/rpc-worker-beacon-macos
    
    # Optional: Re-sign for local execution
    if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
        echo -e "${YELLOW}Signing macOS binary...${NC}"
        codesign -s "$APPLE_SIGNING_IDENTITY" dist/rpc-worker-beacon-macos
    else
        echo -e "${YELLOW}Note: Binary is unsigned. Set APPLE_SIGNING_IDENTITY to sign.${NC}"
        # Ad-hoc sign for local testing
        codesign -s - dist/rpc-worker-beacon-macos 2>/dev/null || true
    fi
    
    echo -e "${GREEN}macOS binary built: dist/rpc-worker-beacon-macos${NC}"
    
    # Create universal binary if on ARM Mac and x64 Node is available
    if [ "$ARCH" = "arm64" ] && command -v lipo &> /dev/null; then
        echo -e "${YELLOW}Note: For a universal binary, build on both arm64 and x64, then use:${NC}"
        echo "lipo -create -output dist/rpc-worker-beacon-macos-universal dist/rpc-worker-beacon-macos-arm64 dist/rpc-worker-beacon-macos-x64"
    fi
}

# Build Linux binary (for CI testing)
build_linux() {
    echo -e "${YELLOW}Building Linux binary...${NC}"
    
    NODE_PATH=$(which node)
    cp "$NODE_PATH" dist/rpc-worker-beacon-linux
    
    npx postject dist/rpc-worker-beacon-linux NODE_SEA_BLOB sea-prep.blob \
        --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    
    chmod +x dist/rpc-worker-beacon-linux
    
    echo -e "${GREEN}Linux binary built: dist/rpc-worker-beacon-linux${NC}"
}

# Instructions for Windows build
print_windows_instructions() {
    echo ""
    echo -e "${YELLOW}=== Windows Build Instructions ===${NC}"
    echo ""
    echo "To build the Windows executable, run the following on a Windows machine or in GitHub Actions:"
    echo ""
    echo "1. Generate the SEA blob (if not already done):"
    echo "   node --experimental-sea-config sea-config.json"
    echo ""
    echo "2. Copy Node.js executable:"
    echo "   copy \"C:\\Program Files\\nodejs\\node.exe\" dist\\rpc-worker-beacon-win.exe"
    echo ""
    echo "3. Inject the SEA blob:"
    echo "   npx postject dist\\rpc-worker-beacon-win.exe NODE_SEA_BLOB sea-prep.blob ^"
    echo "       --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
    echo ""
    echo "4. (Optional) Sign the executable:"
    echo "   signtool sign /f certificate.pfx /p password /t http://timestamp.digicert.com dist\\rpc-worker-beacon-win.exe"
    echo ""
}

# Main build
build_current_platform

# Print Windows instructions
print_windows_instructions

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
rm -f sea-prep.blob

echo ""
echo -e "${GREEN}=== Build Complete ===${NC}"
echo "Output files are in: $SCRIPT_DIR/dist/"
ls -la dist/ 2>/dev/null || echo "No binaries built (expected on non-macOS/Linux platforms)"
