# RPC Cluster - Distributed llama.cpp Inference
# Makefile for building all components

.PHONY: all plugin beacon installer-win installer-macos clean dev test help

# Default target
all: plugin beacon

# Help target
help:
	@echo "RPC Cluster Build Targets:"
	@echo ""
	@echo "  make plugin         - Build the LM Studio plugin (TypeScript)"
	@echo "  make beacon         - Build the worker beacon executable"
	@echo "  make installer-win  - Build Windows installer (requires Windows + Inno Setup)"
	@echo "  make installer-macos- Build macOS installer (requires macOS)"
	@echo "  make all            - Build plugin and beacon"
	@echo "  make test           - Run plugin tests"
	@echo "  make dev            - Run plugin in development mode"
	@echo "  make clean          - Remove all build artifacts"
	@echo ""
	@echo "Note: Installer targets require platform-specific tools:"
	@echo "  - Windows: Inno Setup 6 (choco install innosetup)"
	@echo "  - macOS: Xcode Command Line Tools (xcode-select --install)"

# Build the LM Studio plugin
plugin:
	@echo "=== Building LM Studio Plugin ==="
	cd rpc-cluster-plugin && npm install && npm run build
	@echo "Plugin built: rpc-cluster-plugin/dist/"

# Run plugin tests
test:
	@echo "=== Running Plugin Tests ==="
	cd rpc-cluster-plugin && npm install && npm test

# Run plugin in development mode
dev:
	@echo "=== Starting Plugin Development Mode ==="
	cd rpc-cluster-plugin && npm install && npm run dev

# Build worker beacon
beacon:
	@echo "=== Building Worker Beacon ==="
	cd worker-beacon && chmod +x build.sh && ./build.sh
	@echo "Beacon built: worker-beacon/dist/"

# Build Windows installer (must run on Windows)
installer-win:
	@echo "=== Building Windows Installer ==="
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File installers/windows/build-windows-installer.ps1
else
	@echo "Error: Windows installer must be built on Windows"
	@echo "Use GitHub Actions workflow or run on a Windows machine"
	@exit 1
endif

# Build macOS installer (must run on macOS)
installer-macos:
	@echo "=== Building macOS Installer ==="
ifeq ($(shell uname -s),Darwin)
	chmod +x installers/macos/build-macos-installer.sh
	chmod +x installers/macos/scripts/preinstall
	chmod +x installers/macos/scripts/postinstall
	./installers/macos/build-macos-installer.sh
else
	@echo "Error: macOS installer must be built on macOS"
	@echo "Use GitHub Actions workflow or run on a Mac"
	@exit 1
endif

# Clean all build artifacts
clean:
	@echo "=== Cleaning Build Artifacts ==="
	rm -rf rpc-cluster-plugin/dist
	rm -rf rpc-cluster-plugin/node_modules
	rm -rf worker-beacon/dist
	rm -rf worker-beacon/sea-prep.blob
	rm -rf installers/macos/build
	rm -rf dist
	@echo "Clean complete"

# Install development dependencies
setup:
	@echo "=== Installing Development Dependencies ==="
	cd rpc-cluster-plugin && npm install
	@echo "Setup complete"

# Lint code
lint:
	@echo "=== Linting Code ==="
	cd rpc-cluster-plugin && npm run typecheck
	@echo "Lint complete"

# Create vendor directories for manual binary placement
vendor-dirs:
	@echo "=== Creating Vendor Directories ==="
	mkdir -p vendor/windows
	mkdir -p vendor/macos
	@echo ""
	@echo "Please download llama.cpp binaries from:"
	@echo "  https://github.com/ggerganov/llama.cpp/releases"
	@echo ""
	@echo "Place the following files:"
	@echo "  vendor/windows/rpc-server.exe"
	@echo "  vendor/macos/rpc-server"
