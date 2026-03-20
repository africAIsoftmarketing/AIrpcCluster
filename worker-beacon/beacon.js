#!/usr/bin/env node

/**
 * RPC Cluster Worker Beacon
 * 
 * This script broadcasts the worker's presence on the local network
 * via UDP so the host plugin can discover it automatically.
 * 
 * Runs as a background service on worker machines.
 */

const dgram = require('dgram');
const os = require('os');
const { execSync } = require('child_process');

// Configuration
const BROADCAST_PORT = 5005;
const RPC_SERVER_PORT = 50052;
const BROADCAST_INTERVAL_MS = 3000;
const BROADCAST_ADDRESS = '255.255.255.255';

/**
 * Get the first non-loopback IPv4 address
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  
  return '127.0.0.1';
}

/**
 * Detect VRAM on macOS by parsing system_profiler output
 */
function detectVRAMMacOS() {
  try {
    const output = execSync('system_profiler SPDisplaysDataType', {
      encoding: 'utf-8',
      timeout: 10000
    });
    
    // Look for VRAM patterns like "VRAM (Total): 8 GB" or "VRAM (Dynamic, Max): 48 GB"
    const vramMatch = output.match(/VRAM\s*\([^)]+\):\s*(\d+)\s*(GB|MB)/i);
    if (vramMatch) {
      const value = parseInt(vramMatch[1], 10);
      const unit = vramMatch[2].toUpperCase();
      return unit === 'GB' ? value : Math.floor(value / 1024);
    }
    
    // Also check for "Metal Family" which indicates GPU capability
    // Unified memory Macs report their RAM as shared with GPU
    const unifiedMatch = output.match(/Unified Memory/i);
    if (unifiedMatch) {
      const totalMemGB = Math.floor(os.totalmem() / (1024 * 1024 * 1024));
      // Unified memory typically allocates ~75% to GPU max
      return Math.floor(totalMemGB * 0.75);
    }
    
    return 0;
  } catch (err) {
    console.error('[beacon] Failed to detect VRAM on macOS:', err.message);
    return 0;
  }
}

/**
 * Detect VRAM on Windows by parsing wmic output
 */
function detectVRAMWindows() {
  try {
    const output = execSync('wmic path Win32_VideoController get AdapterRAM', {
      encoding: 'utf-8',
      timeout: 10000
    });
    
    // Parse the output - wmic returns values in bytes
    const lines = output.split('\n').filter(line => line.trim() && !line.includes('AdapterRAM'));
    
    let maxVRAM = 0;
    for (const line of lines) {
      const bytes = parseInt(line.trim(), 10);
      if (!isNaN(bytes) && bytes > 0) {
        const gb = Math.floor(bytes / (1024 * 1024 * 1024));
        maxVRAM = Math.max(maxVRAM, gb);
      }
    }
    
    return maxVRAM;
  } catch (err) {
    console.error('[beacon] Failed to detect VRAM on Windows:', err.message);
    return 0;
  }
}

/**
 * Detect VRAM on Linux by parsing nvidia-smi or lspci
 */
function detectVRAMLinux() {
  try {
    // Try nvidia-smi first for NVIDIA GPUs
    try {
      const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
        encoding: 'utf-8',
        timeout: 10000
      });
      
      const lines = output.split('\n').filter(line => line.trim());
      let maxVRAM = 0;
      for (const line of lines) {
        const mb = parseInt(line.trim(), 10);
        if (!isNaN(mb) && mb > 0) {
          maxVRAM = Math.max(maxVRAM, Math.floor(mb / 1024));
        }
      }
      
      if (maxVRAM > 0) return maxVRAM;
    } catch (e) {
      // nvidia-smi not available
    }
    
    // Fallback to lspci for AMD/Intel GPUs
    try {
      const output = execSync('lspci -v 2>/dev/null | grep -i "Memory.*prefetchable"', {
        encoding: 'utf-8',
        timeout: 10000,
        shell: '/bin/bash'
      });
      
      // Parse memory size from lspci output
      const sizeMatch = output.match(/\[size=(\d+)(G|M)\]/i);
      if (sizeMatch) {
        const value = parseInt(sizeMatch[1], 10);
        const unit = sizeMatch[2].toUpperCase();
        return unit === 'G' ? value : Math.floor(value / 1024);
      }
    } catch (e) {
      // lspci parsing failed
    }
    
    return 0;
  } catch (err) {
    console.error('[beacon] Failed to detect VRAM on Linux:', err.message);
    return 0;
  }
}

/**
 * Detect VRAM based on platform
 */
function detectVRAM() {
  const platform = process.platform;
  
  switch (platform) {
    case 'darwin':
      return detectVRAMMacOS();
    case 'win32':
      return detectVRAMWindows();
    case 'linux':
      return detectVRAMLinux();
    default:
      console.warn(`[beacon] Unknown platform ${platform}, reporting 0 VRAM`);
      return 0;
  }
}

/**
 * Build the beacon payload
 */
function buildBeaconPayload() {
  const hostname = os.hostname();
  const ip = getLocalIP();
  const vramGB = detectVRAM();
  const platform = process.platform;
  
  return JSON.stringify({
    hostname,
    ip,
    port: RPC_SERVER_PORT,
    vramGB,
    platform
  });
}

/**
 * Main beacon loop
 */
function startBeacon() {
  console.log('[beacon] RPC Cluster Worker Beacon starting...');
  
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let intervalId = null;
  
  // Store socket reference for cleanup
  const cleanup = () => {
    console.log('[beacon] Cleaning up...');
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    try {
      socket.close();
    } catch (e) {
      // Ignore close errors
    }
  };
  
  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[beacon] Received SIGTERM, shutting down...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[beacon] Received SIGINT, shutting down...');
    cleanup();
    process.exit(0);
  });
  
  socket.on('error', (err) => {
    console.error('[beacon] Socket error:', err.message);
    // Attempt to recover
    setTimeout(() => {
      console.log('[beacon] Attempting to restart beacon...');
      cleanup();
      startBeacon();
    }, 5000);
  });
  
  socket.bind(() => {
    socket.setBroadcast(true);
    
    const localIP = getLocalIP();
    const vramGB = detectVRAM();
    const hostname = os.hostname();
    
    console.log('[beacon] Beacon initialized:');
    console.log(`[beacon]   Hostname: ${hostname}`);
    console.log(`[beacon]   IP: ${localIP}`);
    console.log(`[beacon]   RPC Port: ${RPC_SERVER_PORT}`);
    console.log(`[beacon]   VRAM: ${vramGB > 0 ? vramGB + ' GB' : 'CPU only'}`);
    console.log(`[beacon]   Platform: ${process.platform}`);
    console.log(`[beacon] Broadcasting to ${BROADCAST_ADDRESS}:${BROADCAST_PORT} every ${BROADCAST_INTERVAL_MS}ms`);
    
    // Send initial beacon
    sendBeacon();
    
    // Schedule periodic broadcasts
    intervalId = setInterval(sendBeacon, BROADCAST_INTERVAL_MS);
  });
  
  function sendBeacon() {
    const payload = buildBeaconPayload();
    const message = Buffer.from(payload, 'utf-8');
    
    socket.send(message, 0, message.length, BROADCAST_PORT, BROADCAST_ADDRESS, (err) => {
      if (err) {
        console.error('[beacon] Failed to send beacon:', err.message);
      }
    });
  }
}

// Start the beacon
startBeacon();
