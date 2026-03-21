# RPC Cluster - Product Requirements Document

## Original Problem Statement
Build the `rpc-cluster` system to distribute LLM inference across multiple devices on a local network using llama.cpp's RPC backend. Components: LM Studio Plugin, Node.js UDP worker beacon, cross-platform installers, Electron Configurator app, Android worker app.

## Architecture
```
/app/
├── .github/workflows/         # CI/CD (macOS, Win, Linux, Android, Configurator)
├── android-worker/            # Kotlin/NDK Android worker (JNI llama.cpp rpc-server)
├── configurator/              # Electron GUI (vanilla HTML/JS/CSS)
│   ├── main.js                # IPC handlers, multi-model management, hardware detection
│   ├── preload.js             # contextBridge (8 model handlers + existing ones)
│   ├── renderer/index.html    # Step 0-5 UI with multi-model support
│   └── shared/discovery.js
├── installers/                # Native OS installers
├── rpc-cluster-plugin/        # LM Studio Plugin (TypeScript/ESM)
├── worker-beacon/             # Node.js UDP broadcaster
└── README.md
```

## Config Schema (v2)
```json
{
  "version": 2,
  "workers": [{ "hostname", "ip", "port", "vramGB", "platform", "enabled" }],
  "models": [{ "id", "name", "modelPath", "port", "nGpuLayers", "maxTokens", "temperature", "enabled", "status" }]
}
```
- Auto-migration from v1 (single modelPath) to v2 (models array)
- Status always reset to "stopped" on load

## Key Ports
- 5005/UDP: Discovery broadcast
- 50052/TCP: Worker RPC server
- 18080+/TCP: Inference servers (one per model, auto-assigned)
- 18090/TCP: Reserved for test-cluster (excluded from auto-assignment)

## Completed Features
- [x] LM Studio Plugin with SDK integration
- [x] UDP Worker Beacon with directed subnet broadcast
- [x] Windows/macOS/Linux native installers + CI/CD
- [x] Android Worker App (Kotlin, NDK, JNI)
- [x] Configurator Step 0: Hardware detection, llama-server auto-installer, DLL extraction, Reinstall/Repair
- [x] Configurator Step 1: LAN worker scan + manual IP entry
- [x] Configurator Step 2: **Multi-model manager** (add/edit/remove models, inline forms, per-model cards)
- [x] Configurator Step 3: Advanced settings (defaults for new models)
- [x] Configurator Step 4: Save & test (per-model sequential testing with results)
- [x] Configurator Step 5: **Per-model inference server management** (start/stop individually or all, progress, curl commands)
- [x] Config v2 schema with v1→v2 auto-migration
- [x] inferenceProcesses Map (multiple concurrent llama-server processes)
- [x] Sequential "Start all" with 2s gap (RAM contention prevention)
- [x] DLL pre-flight check before starting any model
- [x] Port auto-assignment (18080+, skips 18090)

## Test Suite
- 54 tests across 4 files in `rpc-cluster-plugin/` — all passing

## Backlog
- P1: E2E testing (Electron + Android worker + distributed inference)
- P2: Code signing for production distribution
- P3: Refactor index.html (~2100 lines) — split JS/CSS into external files
