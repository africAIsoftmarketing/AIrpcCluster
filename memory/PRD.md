# RPC Cluster — Product Requirements Document

## Original Problem Statement
Build the `rpc-cluster` system to distribute LLM inference across multiple devices on a local network using llama.cpp's RPC backend. The system includes:
- An LM Studio Generator Plugin (`rpc-cluster-plugin`)
- A Node.js UDP worker beacon (`worker-beacon`)
- Cross-platform native installers (`installers/`)
- A standalone Electron Configurator app (`configurator/`)
- An Android worker application (`android-worker/`)

## Architecture
```
/app/
├── .github/workflows/         # CI/CD (macOS, Win, Linux, Android, Configurator)
├── android-worker/            # Android Kotlin/NDK app (JNI wrapper for llama.cpp rpc-server)
├── configurator/              # Electron GUI (vanilla HTML/JS/CSS, no frameworks)
│   ├── main.js                # IPC handlers, hardware detection, zip extraction
│   ├── preload.js             # contextBridge API surface
│   ├── renderer/index.html    # Step 0-5 state machine UI
│   └── shared/discovery.js    # UDP discovery
├── installers/                # Native OS installers (macOS, Windows, Linux)
├── rpc-cluster-plugin/        # LM Studio Plugin (TypeScript/ESM)
│   └── src/index.ts           # PluginContext.withGenerator entry point
├── worker-beacon/             # Node.js UDP beacon broadcaster
├── Makefile
└── README.md
```

## Key Ports
- 5005/UDP: Discovery broadcast
- 50052/TCP: Worker RPC server
- 18080/TCP: Inference server (Configurator Step 5)
- 18090/TCP: Test cluster server

## Constraints
- Configurator: vanilla HTML/JS/CSS only (no React/Vue/Vite)
- LM Studio SDK: must use `export async function main(context: PluginContext)` with ESM/NodeNext
- Android: JNI runs llama.cpp rpc-server in `std::thread`; requires WakeLock + MulticastLock

## Completed Features
- [x] LM Studio Plugin (`rpc-cluster-plugin`) with SDK integration
- [x] UDP Worker Beacon with directed subnet broadcast
- [x] Windows/macOS/Linux native installers + CI/CD
- [x] Configurator Electron app (Steps 0-5)
- [x] Step 0: Hardware detection (GPU/VRAM) + llama-server auto-installer
- [x] Step 0: Full zip extraction (all .dll/.so/.dylib files, not just binary)
- [x] Step 0: DLL completeness check (`check-llama-installation`)
- [x] Step 0: Reinstall/Repair UI (subtle button + prominent warning when DLLs missing)
- [x] Step 0: Repair mode banner, `isRepairMode` state flag
- [x] Step 1: LAN worker scan + manual IP entry
- [x] Step 2: Model browser + manual path input
- [x] Step 3: Advanced settings (GPU layers, tokens, temperature)
- [x] Step 4: Save & test cluster
- [x] Step 5: Start/stop inference server with DLL pre-flight check
- [x] Edit, Reset, Clear all flows
- [x] Android Worker App (Kotlin, Jetpack Compose, NDK/JNI)
- [x] All CI/CD pipelines (GitHub Actions)

## Test Suite
- 54 tests across 4 files in `rpc-cluster-plugin/` (discovery, config, utils, generator) — all passing

## Backlog
- P1: Comprehensive E2E testing (Electron app + Android worker + distributed inference)
- P2: Code signing for production distribution (GitHub secrets)
- P3: Refactor index.html (~1840 lines) — split JS/CSS into external files
