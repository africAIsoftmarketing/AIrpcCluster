import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Worker configuration schema
 */
export const WorkerSchema = z.object({
  hostname: z.string().min(1),
  ip: z.string().min(1),
  port: z.number().int().positive().default(50052),
  vramGB: z.number().min(0).default(0),
  enabled: z.boolean().default(true)
});

export type WorkerConfig = z.infer<typeof WorkerSchema>;

/**
 * Configuration schema for the RPC Cluster plugin
 */
export const ConfigSchema = z.object({
  modelPath: z.string().min(1, 'Model path is required'),
  discoveryTimeoutMs: z.number().int().positive().default(4000),
  nGpuLayers: z.number().int().min(-1).default(99),
  maxTokens: z.number().int().positive().default(2048),
  temperature: z.number().min(0).max(2).default(0.7),
  workers: z.array(WorkerSchema).default([]),
  discoveredWorkers: z.string().optional().default('')
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = {
  modelPath: '',
  discoveryTimeoutMs: 4000,
  nGpuLayers: 99,
  maxTokens: 2048,
  temperature: 0.7,
  workers: [],
  discoveredWorkers: ''
};

/**
 * Path to the configuration file
 */
const CONFIG_FILE_NAME = 'config.json';

/**
 * Get the configuration file path based on platform
 */
export function getConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'rpc-cluster', CONFIG_FILE_NAME);
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'rpc-cluster', CONFIG_FILE_NAME);
  } else {
    return path.join(os.homedir(), '.config', 'rpc-cluster', CONFIG_FILE_NAME);
  }
}

/**
 * Exported config path for external use
 */
export const CONFIG_PATH = getConfigPath();

/**
 * Load configuration from file
 * @returns Parsed and validated configuration
 * @throws Error if file cannot be read or parsed
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  
  let rawContent: string;
  try {
    rawContent = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to read config file at ${configPath}: ${error.message}`);
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to parse config file as JSON: ${error.message}`);
  }
  
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  
  return result.data;
}

/**
 * Save configuration to file
 * @param config - Configuration to save
 */
export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const validated = ConfigSchema.parse(config);
  fs.writeFileSync(configPath, JSON.stringify(validated, null, 2), 'utf-8');
}

/**
 * Update discovered workers in config (runtime only, not persisted)
 */
export function formatDiscoveredWorkers(workers: Array<{ hostname: string; ip: string; vramGB: number }>): string {
  if (workers.length === 0) {
    return 'No workers discovered';
  }
  
  return workers
    .map(w => {
      const vramInfo = w.vramGB > 0 ? `${w.vramGB} GB VRAM` : 'CPU';
      return `${w.hostname} (${w.ip} · ${vramInfo})`;
    })
    .join(', ');
}
