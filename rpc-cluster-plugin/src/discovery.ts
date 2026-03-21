import * as dgram from 'dgram';

/**
 * Represents a discovered worker node on the network
 */
export interface Worker {
  hostname: string;
  ip: string;
  port: number;
  vramGB: number;
  platform: string;
}

/**
 * Schema for validating incoming beacon payloads
 */
interface BeaconPayload {
  hostname: string;
  ip: string;
  port: number;
  vramGB: number;
  platform: string;
}

/**
 * UDP discovery port used by workers and the host
 */
export const DISCOVERY_PORT = 5005;

/**
 * Validates that a parsed object is a valid beacon payload
 */
function isValidBeaconPayload(obj: unknown): obj is BeaconPayload {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  
  const payload = obj as Record<string, unknown>;
  
  return (
    typeof payload.hostname === 'string' &&
    typeof payload.ip === 'string' &&
    typeof payload.port === 'number' &&
    typeof payload.vramGB === 'number' &&
    typeof payload.platform === 'string' &&
    payload.hostname.length > 0 &&
    payload.ip.length > 0 &&
    payload.port > 0 &&
    payload.port < 65536 &&
    payload.vramGB >= 0
  );
}

/**
 * Discovers workers on the local network via UDP broadcast
 * 
 * @param timeoutMs - How long to listen for worker beacons (default: 4000ms)
 * @returns Promise resolving to an array of discovered workers, sorted by VRAM descending
 */
export function discoverWorkers(timeoutMs: number = 4000): Promise<Worker[]> {
  return new Promise((resolve) => {
    const workers = new Map<string, Worker>();
    let socket: dgram.Socket | null = null;
    
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
    
    socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
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
          const worker: Worker = {
            hostname: payload.hostname,
            ip: workerIp,
            port: payload.port,
            vramGB: payload.vramGB,
            platform: payload.platform
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
          socket?.setBroadcast(true);
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
 * Builds the --rpc argument string for llama-server from discovered workers
 * 
 * @param workers - Array of discovered workers
 * @returns RPC argument string in format "ip:port,ip:port,..."
 */
export function buildRpcArgument(workers: Worker[]): string {
  return workers.map(w => `${w.ip}:${w.port}`).join(',');
}
