import { z } from 'zod';
/**
 * Configuration schema for the RPC Cluster plugin
 */
export declare const ConfigSchema: z.ZodObject<{
    modelPath: z.ZodString;
    discoveryTimeoutMs: z.ZodDefault<z.ZodNumber>;
    nGpuLayers: z.ZodDefault<z.ZodNumber>;
    maxTokens: z.ZodDefault<z.ZodNumber>;
    temperature: z.ZodDefault<z.ZodNumber>;
    discoveredWorkers: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    modelPath: string;
    discoveryTimeoutMs: number;
    nGpuLayers: number;
    maxTokens: number;
    temperature: number;
    discoveredWorkers: string;
}, {
    modelPath: string;
    discoveryTimeoutMs?: number | undefined;
    nGpuLayers?: number | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
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