import { z } from 'zod';
/**
 * Worker configuration schema
 */
export declare const WorkerSchema: z.ZodObject<{
    hostname: z.ZodString;
    ip: z.ZodString;
    port: z.ZodDefault<z.ZodNumber>;
    vramGB: z.ZodDefault<z.ZodNumber>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    hostname: string;
    ip: string;
    port: number;
    vramGB: number;
    enabled: boolean;
}, {
    hostname: string;
    ip: string;
    port?: number | undefined;
    vramGB?: number | undefined;
    enabled?: boolean | undefined;
}>;
export type WorkerConfig = z.infer<typeof WorkerSchema>;
/**
 * Configuration schema for the RPC Cluster plugin
 */
export declare const ConfigSchema: z.ZodObject<{
    modelPath: z.ZodString;
    discoveryTimeoutMs: z.ZodDefault<z.ZodNumber>;
    nGpuLayers: z.ZodDefault<z.ZodNumber>;
    maxTokens: z.ZodDefault<z.ZodNumber>;
    temperature: z.ZodDefault<z.ZodNumber>;
    workers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        hostname: z.ZodString;
        ip: z.ZodString;
        port: z.ZodDefault<z.ZodNumber>;
        vramGB: z.ZodDefault<z.ZodNumber>;
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        hostname: string;
        ip: string;
        port: number;
        vramGB: number;
        enabled: boolean;
    }, {
        hostname: string;
        ip: string;
        port?: number | undefined;
        vramGB?: number | undefined;
        enabled?: boolean | undefined;
    }>, "many">>;
    discoveredWorkers: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    modelPath: string;
    discoveryTimeoutMs: number;
    nGpuLayers: number;
    maxTokens: number;
    temperature: number;
    workers: {
        hostname: string;
        ip: string;
        port: number;
        vramGB: number;
        enabled: boolean;
    }[];
    discoveredWorkers: string;
}, {
    modelPath: string;
    discoveryTimeoutMs?: number | undefined;
    nGpuLayers?: number | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    workers?: {
        hostname: string;
        ip: string;
        port?: number | undefined;
        vramGB?: number | undefined;
        enabled?: boolean | undefined;
    }[] | undefined;
    discoveredWorkers?: string | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
/**
 * Default configuration values
 */
export declare const DEFAULT_CONFIG: Config;
/**
 * Get the configuration file path based on platform
 */
export declare function getConfigPath(): string;
/**
 * Load configuration from file
 * @returns Parsed and validated configuration
 * @throws Error if file cannot be read or parsed
 */
export declare function loadConfig(): Config;
/**
 * Save configuration to file
 * @param config - Configuration to save
 */
export declare function saveConfig(config: Config): void;
/**
 * Update discovered workers in config (runtime only, not persisted)
 */
export declare function formatDiscoveredWorkers(workers: Array<{
    hostname: string;
    ip: string;
    vramGB: number;
}>): string;
//# sourceMappingURL=config.d.ts.map