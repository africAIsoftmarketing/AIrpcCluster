# RPC Cluster Plugin — Foundation Validation

This document confirms that all three foundational layers of the rpc-cluster
system have been validated and pass all checks.

---

## Layer 1 — Plugin Structure Validation

### manifest.json ✅

- [x] `entryPoints.generator` points to `./dist/generator.js`
- [x] All required fields present: `name`, `displayName`, `description`, `version`, `entryPoints`
- [x] No invalid fields that could cause plugin loader rejection
- [x] `engines.lmstudio` specifies minimum version `>=0.3.0`
- [x] `configSchema` properly defines all plugin settings

### package.json ✅

- [x] `"dev": "lms dev"` script present
- [x] `"build": "tsc"` script present
- [x] All dependencies pinned to real semver ranges:
  - `openai: "^4.73.0"`
  - `zod: "^3.23.8"`
- [x] DevDependencies properly versioned:
  - `@types/node: "^20.9.0"`
  - `typescript: "^5.6.3"`
  - `vitest: "^2.1.5"`

### tsconfig.json ✅

- [x] Compiles without errors: `tsc --noEmit` passes
- [x] All imports resolve correctly
- [x] `outDir` set to `./dist`
- [x] `rootDir` set to `./src`
- [x] `strict: true` enabled

### src/generator.ts ✅

- [x] Exports `generate(ctl: GeneratorController, history: Chat): Promise<void>`
- [x] Uses correct LM Studio interface types
- [x] Race condition guard uses shared Promise (`serverReadyPromise`)
- [x] ENOENT error handling for missing `llama-server`

### src/config.ts ✅

- [x] Uses `os.homedir()` for cross-platform paths
- [x] macOS path: `~/Library/Application Support/rpc-cluster/config.json`
- [x] Windows path: `%APPDATA%\rpc-cluster\config.json`
- [x] Linux path: `~/.config/rpc-cluster/config.json`
- [x] Creates parent directory if missing (`fs.mkdirSync` with `recursive: true`)
- [x] Exports `CONFIG_PATH` constant

---

## Layer 2 — Config & Spawn Validation

### Config Loading ✅

- [x] Reads and validates `config.json` via zod schema
- [x] Returns `DEFAULT_CONFIG` when file doesn't exist
- [x] Throws descriptive error on invalid JSON
- [x] Throws descriptive error on schema validation failure

### Worker Detection ✅

- [x] Detects zero enabled workers
- [x] Falls back to local mode with warning via `ctl.statusUpdate()`
- [x] Reports discovered workers via `ctl.setConfig('discoveredWorkers', ...)`

### llama-server Spawn ✅

- [x] Spawns with correct arguments: `-m <modelPath> --port 18080 -ngl <nGpuLayers> --log-disable`
- [x] Adds `--rpc <workers>` flag when workers discovered
- [x] Polls port 18080 every 500ms via `waitForPort()`
- [x] 30 second timeout for server startup

### waitForPort() in utils.ts ✅

- [x] Uses real TCP connect attempt (`net.Socket.connect()`)
- [x] Rejects on timeout with descriptive error
- [x] Resolves on first successful connect
- [x] Properly cleans up socket on each attempt

### toOpenAIMessages() in utils.ts ✅

- [x] Maps `system` → `"system"`
- [x] Maps `user`, `human` → `"user"`
- [x] Maps `assistant`, `bot`, `ai` → `"assistant"`
- [x] Unknown roles default to `"user"`
- [x] Returns correct `{ role, content }` array format

### Error Handling ✅

- [x] ENOENT from spawn caught and surfaced via `ctl.statusUpdate()`
- [x] Human-readable error message for missing `llama-server`
- [x] Server process killed on startup timeout
- [x] Race condition guard prevents double-spawn

---

## Layer 3 — Worker Discovery Validation

### Beacon (worker-beacon/beacon.js) ✅

- [x] Sends to `255.255.255.255` on port `5005`
- [x] `setBroadcast(true)` called in `socket.bind()` callback before first send
- [x] Payload matches schema: `{ hostname, ip, port, vramGB, platform }`
  - `hostname`: `os.hostname()`
  - `ip`: first non-loopback IPv4 (`getLocalIP()`)
  - `port`: hardcoded `50052`
  - `vramGB`: number (0 if detection fails)
  - `platform`: `process.platform`
- [x] Interval is exactly 3000ms
- [x] SIGTERM handler closes socket and exits with code 0

### Discovery (src/discovery.ts) ✅

- [x] Opens UDP4 socket bound to port `5005`
- [x] `setBroadcast(true)` called on listening
- [x] JSON parsing in try/catch — malformed packets silently dropped
- [x] Deduplication by `ip` field
- [x] Result sorted by `vramGB` descending
- [x] Socket closed after timeout (no leak)

### End-to-End Trace ✅

Verified via unit test:

```
t=0ms    discoverWorkers(4000) called, socket opens on port 5005
t=500ms  beacon packet arrives: Laptop-B, 192.168.1.12, port 50052, 8GB VRAM
t=800ms  duplicate beacon from same IP arrives — deduplicated
t=4000ms timeout fires, socket closes
         returns [{ hostname:"Laptop-B", ip:"192.168.1.12",
                    port:50052, vramGB:8, platform:"win32" }]
```

---

## Test Summary

```
 Test Files  4 passed (4)
      Tests  54 passed (54)
```

| Test File | Tests | Status |
|-----------|-------|--------|
| discovery.test.ts | 12 | ✅ PASS |
| config.test.ts | 17 | ✅ PASS |
| generator.test.ts | 11 | ✅ PASS |
| utils.test.ts | 14 | ✅ PASS |

---

## Verification Commands

### Build Plugin

```bash
cd rpc-cluster-plugin && npm install && npm run build
# Must exit 0
```

### Run Tests

```bash
cd rpc-cluster-plugin && npm test
# Must exit 0, all tests green
```

### Manual Layer 2 Verification (requires llama-server)

#### Layer 2 — Local inference without workers

```bash
# 1. Write a minimal config.json to the correct platform path
#    macOS:
mkdir -p ~/Library/Application\ Support/rpc-cluster
cat > ~/Library/Application\ Support/rpc-cluster/config.json << 'EOF'
{
  "modelPath": "/path/to/your/model.gguf",
  "nGpuLayers": 0,
  "maxTokens": 128,
  "temperature": 0.7,
  "discoveryTimeoutMs": 1000,
  "workers": []
}
EOF

#    Windows (PowerShell):
# mkdir -p $env:APPDATA\rpc-cluster
# Set-Content -Path "$env:APPDATA\rpc-cluster\config.json" -Value @'
# {
#   "modelPath": "C:\\path\\to\\your\\model.gguf",
#   "nGpuLayers": 0,
#   "maxTokens": 128,
#   "temperature": 0.7,
#   "discoveryTimeoutMs": 1000,
#   "workers": []
# }
# '@

# 2. Build and start the plugin
cd rpc-cluster-plugin && npm run build && lms dev

# 3. Open LM Studio → model picker → select "RPC Cluster"
# 4. Send any message
# Expected: plugin status shows "No workers found - using local inference only"
#           llama-server spawns, tokens stream into LM Studio chat
```

### Manual Layer 3 Verification (requires two machines)

#### Layer 3 — Distributed inference with a real worker

```bash
# === On the WORKER laptop ===

# Option A: Run the beacon manually (for testing)
cd worker-beacon
node beacon.js
# Should output: Broadcasting to 255.255.255.255:5005 every 3000ms

# Option B: Run the rpc-server manually (replace with actual binary path)
./rpc-server -H 0.0.0.0 -p 50052 -m 0
# Or if installed via the installer, the service is already running

# Verify the worker is broadcasting:
# The beacon should log its IP address on startup

# === On the HOST laptop ===

# Option 1: Let the plugin auto-discover workers
# Just run: lms dev
# The plugin will discover workers via UDP broadcast within discoveryTimeoutMs

# Option 2: Manually add workers to config.json (for static configuration)
cat > ~/Library/Application\ Support/rpc-cluster/config.json << 'EOF'
{
  "modelPath": "/path/to/your/model.gguf",
  "nGpuLayers": 99,
  "maxTokens": 2048,
  "temperature": 0.7,
  "discoveryTimeoutMs": 4000,
  "workers": [
    {
      "hostname": "Worker-Laptop",
      "ip": "192.168.1.100",
      "port": 50052,
      "vramGB": 8,
      "enabled": true
    }
  ]
}
EOF

# Start the plugin
cd rpc-cluster-plugin && npm run build && lms dev

# Expected behavior:
# 1. discoverWorkers() returns the worker within 4 seconds
# 2. llama-server spawns with --rpc 192.168.1.100:50052
# 3. On first run, tensor weights transfer to worker (5-10 min on Wi-Fi for 70B)
# 4. Subsequent runs use cached weights and start fast
# 5. Tokens stream into LM Studio chat

# Verify worker is being used:
# Check the plugin status message shows "Starting llama-server with 1 RPC worker(s)"
# Check worker logs show incoming connections
```

#### Verifying network discovery

```bash
# On the HOST, verify beacon packets are arriving:
sudo tcpdump -i any udp port 5005 -A

# You should see JSON payloads like:
# {"hostname":"Worker-Laptop","ip":"192.168.1.100","port":50052,"vramGB":8,"platform":"darwin"}
```

---

## Bugs Fixed

1. **config.ts**: Changed from `process.env.HOME || process.env.USERPROFILE` to `os.homedir()` for reliable cross-platform home directory detection.

2. **config.ts**: Added `CONFIG_PATH` export for external consumers.

3. **generator.ts**: Changed from boolean `isServerStarting` flag to Promise-based `serverReadyPromise` guard to properly handle concurrent calls waiting for the same server startup.

4. **generator.ts**: Added ENOENT error handling in spawn try/catch block to provide human-readable error message when llama-server is not found.

5. **generator.ts**: Added `ctl.statusUpdate()` call before throwing llama-server not found error for better UX.

6. **beacon.js**: Fixed SIGTERM/SIGINT handlers to call `process.exit(0)` inside the `socket.close()` callback, ensuring the socket is fully closed before exit.

---

## Conclusion

All three foundation layers pass validation. The plugin is ready for Configurator GUI development.
