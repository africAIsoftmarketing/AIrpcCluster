const dgram = require('dgram');
const os = require('os');
const path = require('path');

const DISCOVERY_PORT = 5005;

/**
 * Get config file path based on platform
 */
function getConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'rpc-cluster', 'config.json');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'rpc-cluster', 'config.json');
  } else {
    return path.join(os.homedir(), '.config', 'rpc-cluster', 'config.json');
  }
}

const CONFIG_PATH = getConfigPath();

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
 * Validates that a parsed object is a valid beacon payload
 */
function isValidBeaconPayload(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  
  return (
    typeof obj.hostname === 'string' &&
    typeof obj.ip === 'string' &&
    typeof obj.port === 'number' &&
    typeof obj.vramGB === 'number' &&
    typeof obj.platform === 'string' &&
    obj.hostname.length > 0 &&
    obj.ip.length > 0 &&
    obj.port > 0 &&
    obj.port < 65536 &&
    obj.vramGB >= 0
  );
}

/**
 * Discovers workers on the local network via UDP broadcast
 * 
 * @param {number} timeoutMs - How long to listen for worker beacons (default: 4000ms)
 * @returns {Promise<Array>} Promise resolving to an array of discovered workers, sorted by VRAM descending
 */
function discoverWorkers(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const workers = new Map();
    let socket = null;
    
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      console.error('[discovery] Failed to create UDP socket:', err);
      resolve([]);
      return;
    }
    
    const cleanup = () => {
      if (socket) {
        try {
          socket.close();
        } catch (err) {
          // Socket may already be closed
        }
        socket = null;
      }
    };
    
    const timeoutId = setTimeout(() => {
      cleanup();
      const workerList = Array.from(workers.values());
      workerList.sort((a, b) => b.vramGB - a.vramGB);
      resolve(workerList);
    }, timeoutMs);
    
    socket.on('error', (err) => {
      console.error('[discovery] Socket error:', err.message);
      clearTimeout(timeoutId);
      cleanup();
      resolve(Array.from(workers.values()).sort((a, b) => b.vramGB - a.vramGB));
    });
    
    socket.on('message', (msg, rinfo) => {
      try {
        const payloadStr = msg.toString('utf-8');
        const payload = JSON.parse(payloadStr);
        
        if (!isValidBeaconPayload(payload)) {
          return;
        }
        
        // Use rinfo.address as authoritative IP source —
        // the payload.ip may be wrong if the worker has
        // multiple interfaces or reports 127.0.0.1
        const workerIp = (payload.ip && payload.ip !== '127.0.0.1')
          ? payload.ip
          : rinfo.address;
        
        if (!workers.has(workerIp)) {
          const worker = {
            hostname: payload.hostname,
            ip: workerIp,
            port: payload.port,
            vramGB: payload.vramGB,
            platform: payload.platform,
            enabled: true
          };
          workers.set(workerIp, worker);
          console.log(`[discovery] Found: ${worker.hostname} @ ${workerIp}:${worker.port} (${worker.vramGB}GB VRAM)`);
        }
      } catch (err) {
        // Silently ignore malformed packets
      }
    });
    
    try {
      socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
        try {
          socket.setBroadcast(true);
          console.log(`[discovery] Listening on 0.0.0.0:${DISCOVERY_PORT}`);
        } catch (err) {
          console.error('[discovery] Failed to enable broadcast:', err);
        }
      });
    } catch (err) {
      console.error('[discovery] Failed to bind to port:', err);
      clearTimeout(timeoutId);
      cleanup();
      resolve([]);
    }
  });
}

/**
 * Probe a single cloud worker by connecting directly via TCP to its RPC port.
 * Works for remote instances (Vast.ai, RunPod, Lambda Labs, etc.) where
 * UDP broadcast cannot cross the internet.
 *
 * @param {string} ip   - Public IP of the cloud instance
 * @param {number} port - RPC server port (default 50052)
 * @param {number} timeoutMs - Connection timeout per attempt
 * @returns {Promise<object|null>} Worker object or null if unreachable
 */
function probeCloudWorker(ip, port = 50052, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = new (require('net').Socket)();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      // Port is open — the RPC server is reachable
      done({
        hostname: ip,          // will be enriched by beacon data if available
        ip,
        port,
        vramGB: 0,             // unknown without beacon; user can check logs
        platform: 'linux',     // cloud instances are almost always Linux
        enabled: true,
        source: 'cloud-probe'
      });
    });

    socket.on('error', () => done(null));
    socket.on('timeout', () => done(null));

    socket.connect(port, ip);
  });
}

/**
 * Scan a list of cloud workers in parallel.
 *
 * @param {Array<{ip:string, port?:number}>} targets
 * @param {number} timeoutMs
 * @returns {Promise<Array>} Reachable workers
 */
async function scanCloudWorkers(targets, timeoutMs = 5000) {
  const results = await Promise.all(
    targets.map(t => probeCloudWorker(t.ip, t.port || 50052, timeoutMs))
  );
  return results.filter(Boolean);
}

module.exports = {
  discoverWorkers,
  probeCloudWorker,
  scanCloudWorkers,
  CONFIG_PATH
};
