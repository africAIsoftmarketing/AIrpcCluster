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
exports.CONFIG_PATH = exports.DEFAULT_CONFIG = exports.ConfigSchema = exports.WorkerSchema = void 0;
exports.getConfigPath = getConfigPath;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.formatDiscoveredWorkers = formatDiscoveredWorkers;
const zod_1 = require("zod");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * Worker configuration schema
 */
exports.WorkerSchema = zod_1.z.object({
    hostname: zod_1.z.string().min(1),
    ip: zod_1.z.string().min(1),
    port: zod_1.z.number().int().positive().default(50052),
    vramGB: zod_1.z.number().min(0).default(0),
    enabled: zod_1.z.boolean().default(true)
});
/**
 * Configuration schema for the RPC Cluster plugin
 */
exports.ConfigSchema = zod_1.z.object({
    modelPath: zod_1.z.string().min(1, 'Model path is required'),
    discoveryTimeoutMs: zod_1.z.number().int().positive().default(4000),
    nGpuLayers: zod_1.z.number().int().min(-1).default(99),
    maxTokens: zod_1.z.number().int().positive().default(2048),
    temperature: zod_1.z.number().min(0).max(2).default(0.7),
    workers: zod_1.z.array(exports.WorkerSchema).default([]),
    discoveredWorkers: zod_1.z.string().optional().default('')
});
/**
 * Default configuration values
 */
exports.DEFAULT_CONFIG = {
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
function getConfigPath() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'rpc-cluster', CONFIG_FILE_NAME);
    }
    else if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'rpc-cluster', CONFIG_FILE_NAME);
    }
    else {
        return path.join(os.homedir(), '.config', 'rpc-cluster', CONFIG_FILE_NAME);
    }
}
/**
 * Exported config path for external use
 */
exports.CONFIG_PATH = getConfigPath();
/**
 * Load configuration from file
 * @returns Parsed and validated configuration
 * @throws Error if file cannot be read or parsed
 */
function loadConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return { ...exports.DEFAULT_CONFIG };
    }
    let rawContent;
    try {
        rawContent = fs.readFileSync(configPath, 'utf-8');
    }
    catch (err) {
        const error = err;
        throw new Error(`Failed to read config file at ${configPath}: ${error.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(rawContent);
    }
    catch (err) {
        const error = err;
        throw new Error(`Failed to parse config file as JSON: ${error.message}`);
    }
    const result = exports.ConfigSchema.safeParse(parsed);
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
function saveConfig(config) {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const validated = exports.ConfigSchema.parse(config);
    fs.writeFileSync(configPath, JSON.stringify(validated, null, 2), 'utf-8');
}
/**
 * Update discovered workers in config (runtime only, not persisted)
 */
function formatDiscoveredWorkers(workers) {
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
//# sourceMappingURL=config.js.map