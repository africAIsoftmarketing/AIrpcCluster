"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISCOVERY_PORT = void 0;
exports.discoverWorkers = discoverWorkers;
exports.buildRpcArgument = buildRpcArgument;
const dgram = __importStar(require("dgram"));
/**
 * UDP discovery port used by workers and the host
 */
exports.DISCOVERY_PORT = 5005;
/**
 * Validates that a parsed object is a valid beacon payload
 */
function isValidBeaconPayload(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const payload = obj;
    return (typeof payload.hostname === 'string' &&
        typeof payload.ip === 'string' &&
        typeof payload.port === 'number' &&
        typeof payload.vramGB === 'number' &&
        typeof payload.platform === 'string' &&
        payload.hostname.length > 0 &&
        payload.ip.length > 0 &&
        payload.port > 0 &&
        payload.port < 65536 &&
        payload.vramGB >= 0);
}
/**
 * Discovers workers on the local network via UDP broadcast
 *
 * @param timeoutMs - How long to listen for worker beacons (default: 4000ms)
 * @returns Promise resolving to an array of discovered workers, sorted by VRAM descending
 */
function discoverWorkers(timeoutMs = 4000) {
    return new Promise((resolve) => {
        const workers = new Map();
        let socket = null;
        try {
            socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        }
        catch (err) {
            console.error('[discovery] Failed to create UDP socket:', err);
            resolve([]);
            return;
        }
        const cleanup = () => {
            if (socket) {
                try {
                    socket.close();
                }
                catch (err) {
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
                const workerIp = payload.ip || rinfo.address;
                if (!workers.has(workerIp)) {
                    const worker = {
                        hostname: payload.hostname,
                        ip: workerIp,
                        port: payload.port,
                        vramGB: payload.vramGB,
                        platform: payload.platform
                    };
                    workers.set(workerIp, worker);
                    console.log(`[discovery] Found worker: ${worker.hostname} at ${worker.ip}:${worker.port} (${worker.vramGB}GB VRAM)`);
                }
            }
            catch (err) {
                // Silently ignore malformed packets - this is expected
                // as other UDP traffic may be received on this port
            }
        });
        socket.on('listening', () => {
            try {
                socket?.setBroadcast(true);
                const addr = socket?.address();
                console.log(`[discovery] Listening for workers on port ${addr?.port}`);
            }
            catch (err) {
                console.error('[discovery] Failed to enable broadcast:', err);
            }
        });
        try {
            socket.bind(exports.DISCOVERY_PORT);
        }
        catch (err) {
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
function buildRpcArgument(workers) {
    return workers.map(w => `${w.ip}:${w.port}`).join(',');
}
//# sourceMappingURL=discovery.js.map