# RPC Cluster - Distributed llama.cpp Inference

Distribute LLM inference across multiple laptops on your local network using llama.cpp's RPC backend. This project provides:

1. **LM Studio Plugin** - A generator plugin that auto-discovers worker machines and distributes inference
2. **Configurator App** - An Electron app for scanning the network and configuring the cluster
3. **Worker Installers** - Native installers for Windows and macOS that set up workers as background services

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Local Network (LAN)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         UDP Broadcast (port 5005)                  │
│  │   Host Laptop       │◄──────────────────────────────────────────┐        │
│  │   (LM Studio)       │                                           │        │
│  │                     │         ┌─────────────────────┐           │        │
│  │  ┌───────────────┐  │         │   Worker Laptop A   │           │        │
│  │  │ RPC Cluster   │  │◄────────│   (8GB VRAM GPU)    │───────────┤        │
│  │  │ Plugin        │  │  RPC    │   rpc-server:50052  │  beacon   │        │
│  │  └───────────────┘  │         └─────────────────────┘           │        │
│  │         │           │                                           │        │
│  │         ▼           │         ┌─────────────────────┐           │        │
│  │  ┌───────────────┐  │         │   Worker Laptop B   │           │        │
│  │  │ llama-server  │  │◄────────│   (CPU only)        │───────────┘        │
│  │  │ --rpc A,B     │  │  RPC    │   rpc-server:50052  │  beacon            │
│  │  └───────────────┘  │         └─────────────────────┘                    │
│  └─────────────────────┘                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Host Machine (runs LM Studio)
- [LM Studio](https://lmstudio.ai/) 0.3.0 or later
- [Node.js](https://nodejs.org/) 22 or later
- [llama.cpp](https://github.com/ggerganov/llama.cpp) with `llama-server` in PATH
- A `.gguf` model file

### Worker Machines
- Windows 10/11 (64-bit) or macOS 13+ (Ventura) or Linux (Ubuntu 20.04+, 64-bit)
- No additional software required - the installer handles everything

## Quick Start

### 1. Set Up Worker Machines

Download the appropriate installer for each worker laptop:

- **Windows**: `rpc-cluster-worker-setup-win64.exe`
- **macOS**: `rpc-cluster-worker-0.1.0-macos.pkg`
- **Linux**: `rpc-cluster-worker-0.1.0-linux-x64.tar.gz`

Run the installer. The RPC server and discovery beacon will start automatically as system services.

**Linux** — extract the tarball and run the install script:
```bash
tar xzf rpc-cluster-worker-0.1.0-linux-x64.tar.gz
cd rpc-cluster-worker-0.1.0-linux-x64
sudo ./install.sh
```

### 2. Configure with the Configurator App

Download and open **RPC Cluster Configurator** (the Electron app included in releases).

1. Click **Scan LAN** to discover all worker machines on your network
2. Review the discovered workers - each shows hostname, IP, and VRAM
3. Enable/disable individual workers using the checkboxes
4. Select a model from the list of `.gguf` files detected in your LM Studio models folder
5. Adjust inference settings (GPU layers, max tokens, temperature) if needed
6. Click **Save configuration** — then close the Configurator and open LM Studio

The configuration is saved to:
- **macOS**: `~/Library/Application Support/rpc-cluster/config.json`
- **Windows**: `%APPDATA%\rpc-cluster\config.json`
- **Linux**: `~/.config/rpc-cluster/config.json`

### 3. Install the LM Studio Plugin

```bash
# Clone this repository
git clone https://github.com/your-org/rpc-cluster.git
cd rpc-cluster

# Install dependencies
cd rpc-cluster-plugin
npm install

# Run in development mode - the plugin appears automatically in LM Studio
npm run dev
```

The plugin will be available in LM Studio while `npm run dev` (which runs `lms dev`) is active.

### 4. Start Using

Select "RPC Cluster" as your model in LM Studio's model picker. The plugin will:

1. Discover workers on your network
2. Start `llama-server` with the appropriate `--rpc` flags
3. Stream responses back to the chat UI

## Building from Source

### Plugin

```bash
cd rpc-cluster-plugin
npm install
npm run build    # Compile TypeScript
npm test         # Run tests
npm run dev      # Development mode - plugin auto-loads in LM Studio
```

### Worker Beacon

The beacon is a Node.js script compiled to a standalone executable:

```bash
cd worker-beacon
./build.sh       # On macOS/Linux
```

For Windows, build via GitHub Actions or manually:

```powershell
node --experimental-sea-config sea-config.json
copy "C:\Program Files\nodejs\node.exe" dist\rpc-worker-beacon-win.exe
npx postject dist\rpc-worker-beacon-win.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

### Installers

**Windows** (requires Inno Setup 6):
```powershell
# Install Inno Setup
choco install innosetup

# Download llama.cpp binary
# Place rpc-server.exe in vendor/windows/

# Build installer
.\installers\windows\build-windows-installer.ps1
```

**macOS** (requires Xcode Command Line Tools):
```bash
# Download llama.cpp binary
# Place rpc-server in vendor/macos/

# Build installer
./installers/macos/build-macos-installer.sh
```

**Linux** (requires systemd):
```bash
# Download llama.cpp binary
# Place rpc-server in vendor/linux/

# Build beacon
cd worker-beacon && ./build.sh && cd ..

# Run the installer directly (or package for distribution)
sudo ./installers/linux/install.sh

# To uninstall
sudo ./installers/linux/install.sh --uninstall
```

## CI/CD

GitHub Actions workflows automatically build installers on push:

- `.github/workflows/build-windows.yml` - Windows installer
- `.github/workflows/build-macos.yml` - macOS installer
- `.github/workflows/build-linux.yml` - Linux installer

Artifacts are uploaded and available for download from the Actions tab.

### Choosing llama.cpp Variants

By default, CI downloads CPU-only binaries for maximum compatibility. To use GPU-accelerated versions:

1. Go to **Actions** → **Build Windows/macOS Installer**
2. Click **Run workflow**
3. Select the desired variant:
   - `cpu` - Maximum compatibility
   - `cuda-cu11.7` - NVIDIA CUDA 11.7
   - `cuda-cu12.4` - NVIDIA CUDA 12.4
   - `vulkan` - Vulkan (cross-vendor GPU)
   - `metal` - Apple Metal (macOS)

## Troubleshooting

### Worker Not Detected

1. **Check network**: Workers must be on the same LAN subnet
2. **Firewall**: Ensure UDP port 5005 and TCP port 50052 are open
3. **Service status**:
   - Windows: `sc query LlamaRPCBeacon`
   - macOS: `sudo launchctl list | grep rpccluster`
   - Linux: `systemctl status rpc-cluster-beacon rpc-cluster-rpcserver`

### llama-server Not Found

Ensure `llama-server` is in your system PATH:

```bash
# Check if available
which llama-server      # macOS/Linux
where llama-server      # Windows

# Add to PATH if needed
export PATH=$PATH:/path/to/llama.cpp/build/bin  # macOS/Linux
```

### Port Already in Use

If port 18080 is already in use:

```bash
# Find the process
lsof -i :18080          # macOS/Linux
netstat -ano | findstr :18080  # Windows

# Kill the process using that port
kill <PID>              # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### Model Not Found

Ensure the model path in plugin config:
- Is an absolute path
- Points to a valid `.gguf` file
- The file is readable by the current user

### Performance Issues

1. **Reduce GPU layers** if running out of VRAM
2. **Increase discovery timeout** if workers are missing
3. **Check worker logs**:
   - macOS: `tail -f /var/log/rpc-server.log`
   - Linux: `journalctl -u rpc-cluster-rpcserver -f`
   - Windows: Event Viewer → Windows Logs → Application

### First Inference is Very Slow

On the first run with a new model or new workers, `llama-server` must transfer the model weights to each worker over the network. This is expected behavior:

- **Wi-Fi**: 5-10 minutes for a 70B model (depending on network speed)
- **Gigabit Ethernet**: 2-4 minutes for a 70B model

Subsequent runs use the local tensor cache on each worker (`/var/cache/llama-rpc` on macOS, `{app}\tensor-cache` on Windows) and start almost instantly.

**Tip**: For faster initial setup, use a wired Ethernet connection for the first model load.

### Changing the llama-server Port

The llama-server API port (18080) is currently hardcoded in the plugin. To change it:

1. Open `rpc-cluster-plugin/src/generator.ts`
2. Find the constant `LLAMA_SERVER_PORT` near the top of the file
3. Change the value to your desired port
4. Rebuild the plugin: `npm run build`
5. Restart LM Studio

Note: This only changes the host-side API port. The worker RPC port (50052) is configured separately in the worker installers.

## Architecture

```
rpc-cluster/
├── rpc-cluster-plugin/         # LM Studio generator plugin
│   ├── src/
│   │   ├── __tests__/          # Unit tests (vitest)
│   │   │   ├── config.test.ts
│   │   │   ├── discovery.test.ts
│   │   │   └── utils.test.ts
│   │   ├── config.ts           # Configuration management
│   │   ├── discovery.ts        # UDP worker discovery
│   │   ├── generator.ts        # Main generator interface
│   │   └── utils.ts            # Helper functions
│   ├── manifest.json           # Plugin metadata
│   ├── package.json
│   └── tsconfig.json
│
├── configurator/               # Electron configurator app
│   ├── main.js                 # Main process
│   ├── preload.js              # Preload script
│   ├── renderer/               # UI components
│   └── shared/                 # Shared utilities
│
├── worker-beacon/              # Worker discovery beacon
│   ├── beacon.js               # Broadcast script
│   ├── build.sh                # SEA compilation
│   ├── package.json
│   └── sea-config.json
│
├── installers/
│   ├── windows/                # Inno Setup installer
│   │   ├── setup.iss
│   │   └── build-windows-installer.ps1
│   ├── macos/                  # pkgbuild installer
│   │   ├── build-macos-installer.sh
│   │   ├── Distribution.xml
│   │   ├── launchd/
│   │   └── scripts/
│   └── linux/                  # systemd installer
│       ├── install.sh
│       ├── rpc-cluster-rpcserver.service
│       └── rpc-cluster-beacon.service
│
├── .github/
│   └── workflows/
│       ├── build-windows.yml   # Windows CI pipeline
│       ├── build-macos.yml     # macOS CI pipeline
│       └── build-linux.yml     # Linux CI pipeline
│
├── vendor/                     # Pre-built binaries (not in git)
│   ├── windows/
│   ├── macos/
│   └── linux/
│
├── Makefile                    # Build orchestration
└── README.md
```

## Configuration Reference

### Config File (`config.json`)

Located at:
- **macOS**: `~/Library/Application Support/rpc-cluster/config.json`
- **Windows**: `%APPDATA%\rpc-cluster\config.json`
- **Linux**: `~/.config/rpc-cluster/config.json`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `modelPath` | string | required | Absolute path to .gguf model |
| `discoveryTimeoutMs` | number | 4000 | Worker discovery timeout (ms) |
| `nGpuLayers` | number | 99 | GPU layers to offload |
| `maxTokens` | number | 2048 | Max tokens to generate |
| `temperature` | number | 0.7 | Sampling temperature |
| `workers` | array | [] | List of configured workers |

### Worker Object (in `workers` array)

| Field | Type | Description |
|-------|------|-------------|
| `hostname` | string | Worker machine hostname |
| `ip` | string | Worker IP address |
| `port` | number | RPC server port (default: 50052) |
| `vramGB` | number | Detected VRAM in gigabytes (0 = CPU only) |
| `enabled` | boolean | Whether to include this worker in inference |

### Example Config

```json
{
  "modelPath": "/Users/alice/models/llama-3-70b.gguf",
  "discoveryTimeoutMs": 4000,
  "nGpuLayers": 99,
  "maxTokens": 2048,
  "temperature": 0.7,
  "workers": [
    {
      "hostname": "MacBook-Pro-Bob",
      "ip": "192.168.1.101",
      "port": 50052,
      "vramGB": 16,
      "enabled": true
    },
    {
      "hostname": "Gaming-PC",
      "ip": "192.168.1.102",
      "port": 50052,
      "vramGB": 24,
      "enabled": true
    },
    {
      "hostname": "Old-Laptop",
      "ip": "192.168.1.103",
      "port": 50052,
      "vramGB": 0,
      "enabled": false
    }
  ]
}
```

### Network Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 5005 | UDP | Worker discovery beacon |
| 50052 | TCP | RPC server (worker) |
| 18080 | TCP | llama-server API (host) |

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## Acknowledgments

- [llama.cpp](https://github.com/ggerganov/llama.cpp) for the incredible inference engine
- [LM Studio](https://lmstudio.ai/) for the plugin SDK
- The open-source LLM community
