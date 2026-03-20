# RPC Cluster - Product Requirements Document

## Project Overview
A distributed llama.cpp inference system for LM Studio that allows spreading inference workload across multiple laptops on a local network using llama.cpp's RPC backend.

## Architecture

### Components
1. **LM Studio Generator Plugin** (`rpc-cluster-plugin/`)
   - TypeScript/Node.js plugin for LM Studio
   - UDP-based worker discovery on port 5005
   - Spawns llama-server with dynamic --rpc flags
   - Streams tokens back to LM Studio chat UI

2. **Worker Beacon** (`worker-beacon/`)
   - Node.js script compiled to standalone executable (SEA)
   - Broadcasts presence via UDP every 3 seconds
   - Detects VRAM/GPU capabilities per platform

3. **Native Installers** (`installers/`)
   - Windows: Inno Setup 6 installer
   - macOS: pkgbuild/productbuild installer
   - Both install rpc-server + beacon as system services

## Tech Stack
- Plugin: TypeScript, Node.js 20+, OpenAI SDK, Zod
- Discovery: UDP broadcast on port 5005
- Inference: llama-server (llama.cpp) on port 18080
- Worker RPC: llama.cpp rpc-server on port 50052
- Testing: Vitest
- CI/CD: GitHub Actions

## What's Been Implemented (2024-03-20)

### Plugin Package
- [x] `manifest.json` - Plugin metadata for LM Studio
- [x] `package.json` - Dependencies and scripts
- [x] `tsconfig.json` - TypeScript configuration
- [x] `vitest.config.ts` - Test configuration
- [x] `src/config.ts` - Configuration management with Zod validation (includes workers array)
- [x] `src/discovery.ts` - UDP worker discovery with deduplication
- [x] `src/generator.ts` - Main generator with llama-server management and Promise-based race condition guard
- [x] `src/utils.ts` - Utility functions (waitForPort, getLocalIP, etc.)
- [x] `src/__tests__/` - 54 passing unit tests

### Configurator App (Electron)
- [x] `package.json` - Electron 31 + electron-builder
- [x] `electron-builder.yml` - Build configuration for mac/win
- [x] `main.js` - Main process with 6 IPC handlers (all with try/catch)
- [x] `preload.js` - Secure context bridge exposing 6 functions
- [x] `renderer/index.html` - Complete single-file app (inline CSS + JS)
- [x] `shared/discovery.js` - UDP worker discovery (CommonJS, exports discoverWorkers + CONFIG_PATH)

### Worker Beacon
- [x] `beacon.js` - UDP broadcast script with VRAM detection
- [x] `package.json` - Package configuration
- [x] `sea-config.json` - Node.js SEA configuration
- [x] `build.sh` - Cross-platform build script

### Windows Installer
- [x] `setup.iss` - Inno Setup script with firewall rules
- [x] `build-windows-installer.ps1` - Build automation
- [x] Service registration for LlamaRPCServer and LlamaRPCBeacon

### macOS Installer
- [x] `build-macos-installer.sh` - pkgbuild/productbuild script
- [x] `Distribution.xml` - Installer distribution config
- [x] LaunchDaemon plists for both services
- [x] Pre/post install scripts
- [x] Welcome, readme, and license HTML files

### CI/CD
- [x] `.github/workflows/build-windows.yml` - Windows CI pipeline
- [x] `.github/workflows/build-macos.yml` - macOS CI pipeline
- [x] Automated llama.cpp binary downloads
- [x] Optional code signing support

### Documentation
- [x] `README.md` - Full setup guide with Configurator App instructions
- [x] `VALIDATION.md` - Foundation validation checklist
- [x] `Makefile` - Build orchestration

## Configuration Schema

Config file location:
- macOS: `~/Library/Application Support/rpc-cluster/config.json`
- Windows: `%APPDATA%\rpc-cluster\config.json`

## Test Status
- 54 tests passing
- Discovery tests: 12 passed
- Config tests: 17 passed
- Generator tests: 11 passed
- Utils tests: 14 passed

## Remaining / Future Work

### P0 (Critical)
- None - MVP complete

### P1 (Important)
- [ ] Add test cluster feature button in configurator
- [ ] Universal binary support for macOS (arm64 + x64)
- [ ] E2E integration tests

### P2 (Nice to Have)
- [ ] GPU variant selection in UI
- [ ] Worker health monitoring
- [ ] Load balancing optimization
- [ ] Model sharing across workers

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| modelPath | string | required | Path to .gguf model |
| discoveryTimeoutMs | number | 4000 | Worker discovery timeout |
| nGpuLayers | number | 99 | GPU layers to offload |
| maxTokens | number | 2048 | Max generation tokens |
| temperature | number | 0.7 | Sampling temperature |
| workers | array | [] | Configured workers list |

### Worker Object Fields
| Field | Type | Description |
|-------|------|-------------|
| hostname | string | Worker machine hostname |
| ip | string | Worker IP address |
| port | number | RPC server port (50052) |
| vramGB | number | Detected VRAM (0 = CPU) |
| enabled | boolean | Include in inference |

## Network Ports
- UDP 5005: Worker discovery
- TCP 50052: RPC server
- TCP 18080: llama-server API
