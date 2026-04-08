# RPC Cluster Configurator - PRD

## Overview
Electron application for configuring and managing distributed llama.cpp inference clusters.

## What's Been Implemented

### 2025-01-XX - Server Logs & Force Start Feature
- **Server Logs Panel**: Added real-time log viewer in Step 5 for each model server
  - Streams stdout/stderr from llama-server process
  - Refresh button for manual log refresh
  - Expand/Collapse button for larger view
  - Clear button to reset logs
  - Auto-scroll to latest entries
- **Force Start**: Added "Force Start" button to bypass normal health checks
  - Kills existing processes on the port (SIGKILL)
  - Extended timeout (60s instead of 30s)
  - Shows progress in logs
  - Useful for 503 errors with distributed inference servers

### 2025-01-XX - Cloud Worker Discovery
- Added `probeCloudWorker` and `scanCloudWorkers` IPC channels in preload.js
- Added Cloud Instance panel in renderer/index.html for Vast.ai/RunPod/Lambda Labs
- Enhanced "no workers found" error message with cloud-specific instructions
- Created `/app/INSTALL-VASTAI.md` installation guide

### 2025-01-XX - llama-server Installation Fixes (Bug 1, 2, 3)
**Bug 1 - CUDA asset naming**: Fixed patterns from `cuda-cu12.4` to `cuda-12.4`
- Centralized asset mapping in `ASSET_NAME_MAP`
- Added fuzzy fallback search with `buildAssetKeywords()`

**Bug 2 - ZIP extraction**: Rewrote with 2-pass approach
- Pass 1: Find binary and its directory
- Pass 2: Extract all files from same directory
- Removed aggressive depth/size filters

**Bug 3 - Error messages**: Enhanced with detailed asset info
- Shows expected filename, available assets, GitHub release link
- `showAssetError()` function in renderer for formatted display

## Core Requirements
- Scan LAN for RPC workers via UDP broadcast (port 5005)
- Probe cloud workers via TCP (port 50052)
- Configure and start llama-server instances
- Auto-install llama-server from GitHub releases
- **View server logs during startup and requests**
- **Force start servers bypassing health checks**

## Files Modified
- `configurator/main.js` - IPC handlers, asset mapping, ZIP extraction, server logs, force-start
- `configurator/preload.js` - Cloud worker IPC channels, server logs, force-start
- `configurator/renderer/index.html` - Cloud panel, error display, logs panel, force-start UI
- `/app/INSTALL-VASTAI.md` - Installation guide (new)

## Backlog
- P1: Test all CUDA/Vulkan variants on Windows
- P2: Add Linux CUDA 11.7 variant support
- P2: Persist cloud worker favorites
- P3: Add RunPod/Lambda Labs specific docs
