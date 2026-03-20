# RPC Cluster - Distributed llama.cpp Inference

Distribute LLM inference across multiple laptops on your local network using llama.cpp's RPC backend. This project provides:

1. **LM Studio Plugin** - A generator plugin that auto-discovers worker machines and distributes inference
2. **Worker Installers** - Native installers for Windows and macOS that set up workers as background services

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
- Windows 10/11 (64-bit) or macOS 13+ (Ventura)
- No additional software required - the installer handles everything

## Quick Start

### 1. Set Up Worker Machines

Download the appropriate installer for each worker laptop:

- **Windows**: `rpc-cluster-worker-setup-win64.exe`
- **macOS**: `rpc-cluster-worker-0.1.0-macos.pkg`

Run the installer. The RPC server and discovery beacon will start automatically as system services.

### 2. Install the LM Studio Plugin

```bash
# Clone this repository
git clone https://github.com/your-org/rpc-cluster.git
cd rpc-cluster

# Build the plugin
cd rpc-cluster-plugin
npm install
npm run build

# Install to LM Studio (adjust path as needed)
cp -r . ~/.lmstudio/plugins/rpc-cluster/
```

### 3. Configure the Plugin

1. Open LM Studio
2. Go to **Settings** → **Plugins** → **RPC Cluster**
3. Set the **Model Path** to your `.gguf` file
4. Adjust other settings as needed:
   - **Discovery Timeout**: How long to scan for workers (default: 4s)
   - **GPU Layers**: Layers to offload to GPU (default: 99)
   - **Max Tokens**: Maximum generation length (default: 2048)
   - **Temperature**: Sampling temperature (default: 0.7)

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
npm run dev      # Development mode with hot reload
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

## CI/CD

GitHub Actions workflows automatically build installers on push:

- `.github/workflows/build-windows.yml` - Windows installer
- `.github/workflows/build-macos.yml` - macOS installer

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

# Kill it or change the port in config
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
   - Windows: Event Viewer → Windows Logs → Application

## Architecture

```
rpc-cluster/
├── rpc-cluster-plugin/     # LM Studio generator plugin
│   ├── src/
│   │   ├── config.ts       # Configuration management
│   │   ├── discovery.ts    # UDP worker discovery
│   │   ├── generator.ts    # Main generator interface
│   │   └── utils.ts        # Helper functions
│   └── manifest.json       # Plugin metadata
│
├── worker-beacon/          # Worker discovery beacon
│   ├── beacon.js           # Broadcast script
│   └── build.sh            # SEA compilation
│
├── installers/
│   ├── windows/            # Inno Setup installer
│   └── macos/              # pkgbuild installer
│
├── .github/workflows/      # CI/CD pipelines
└── Makefile                # Build orchestration
```

## Configuration Reference

### Plugin Config (`rpc-cluster-config.json`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `modelPath` | string | required | Absolute path to .gguf model |
| `discoveryTimeoutMs` | number | 4000 | Worker discovery timeout (ms) |
| `nGpuLayers` | number | 99 | GPU layers to offload |
| `maxTokens` | number | 2048 | Max tokens to generate |
| `temperature` | number | 0.7 | Sampling temperature |

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
