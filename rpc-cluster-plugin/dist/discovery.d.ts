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
 * UDP discovery port used by workers and the host
 */
export declare const DISCOVERY_PORT = 5005;
/**
 * Discovers workers on the local network via UDP broadcast
 *
 * @param timeoutMs - How long to listen for worker beacons (default: 4000ms)
 * @returns Promise resolving to an array of discovered workers, sorted by VRAM descending
 */
export declare function discoverWorkers(timeoutMs?: number): Promise<Worker[]>;
/**
 * Builds the --rpc argument string for llama-server from discovered workers
 *
 * @param workers - Array of discovered workers
 * @returns RPC argument string in format "ip:port,ip:port,..."
 */
export declare function buildRpcArgument(workers: Worker[]): string;
//# sourceMappingURL=discovery.d.ts.map