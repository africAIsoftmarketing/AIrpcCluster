import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
vi.mock('fs');

import { loadConfig, saveConfig, formatDiscoveredWorkers, getConfigPath, DEFAULT_CONFIG } from '../config';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  it('should return default config when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    const config = loadConfig();
    
    expect(config.modelPath).toBe('');
    expect(config.workers).toEqual([]);
    expect(config.discoveryTimeoutMs).toBe(4000);
  });
  
  it('should throw error when file cannot be read', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    
    expect(() => loadConfig()).toThrow('Failed to read config file');
  });
  
  it('should throw error for malformed JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');
    
    expect(() => loadConfig()).toThrow('Failed to parse config file as JSON');
  });
  
  it('should throw error for invalid config values', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      modelPath: '', // Empty string should fail validation
      discoveryTimeoutMs: -100, // Negative should fail
      temperature: 5 // Out of range
    }));
    
    expect(() => loadConfig()).toThrow('Invalid configuration');
  });
  
  it('should load valid config file with workers', () => {
    const validConfig = {
      modelPath: '/path/to/model.gguf',
      discoveryTimeoutMs: 5000,
      nGpuLayers: 32,
      maxTokens: 1024,
      temperature: 0.5,
      workers: [
        {
          hostname: 'worker-1',
          ip: '192.168.1.10',
          port: 50052,
          vramGB: 8,
          enabled: true
        }
      ]
    };
    
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validConfig));
    
    const config = loadConfig();
    
    expect(config.modelPath).toBe('/path/to/model.gguf');
    expect(config.discoveryTimeoutMs).toBe(5000);
    expect(config.nGpuLayers).toBe(32);
    expect(config.maxTokens).toBe(1024);
    expect(config.temperature).toBe(0.5);
    expect(config.workers).toHaveLength(1);
    expect(config.workers[0].hostname).toBe('worker-1');
  });
  
  it('should apply defaults for missing optional fields', () => {
    const partialConfig = {
      modelPath: '/path/to/model.gguf'
    };
    
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(partialConfig));
    
    const config = loadConfig();
    
    expect(config.modelPath).toBe('/path/to/model.gguf');
    expect(config.discoveryTimeoutMs).toBe(4000); // default
    expect(config.nGpuLayers).toBe(99); // default
    expect(config.maxTokens).toBe(2048); // default
    expect(config.temperature).toBe(0.7); // default
    expect(config.workers).toEqual([]); // default
  });
});

describe('saveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should create config directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    
    const config = {
      ...DEFAULT_CONFIG,
      modelPath: '/path/to/model.gguf'
    };
    
    saveConfig(config);
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true }
    );
  });
  
  it('should write config as JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    
    const config = {
      ...DEFAULT_CONFIG,
      modelPath: '/path/to/model.gguf'
    };
    
    saveConfig(config);
    
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"modelPath": "/path/to/model.gguf"'),
      'utf-8'
    );
  });
  
  it('should throw error for invalid config', () => {
    const invalidConfig = {
      modelPath: '',
      discoveryTimeoutMs: -1, // Invalid
      nGpuLayers: 99,
      maxTokens: 2048,
      temperature: 0.7,
      discoveredWorkers: ''
    };
    
    expect(() => saveConfig(invalidConfig)).toThrow();
  });
});

describe('formatDiscoveredWorkers', () => {
  it('should return "No workers discovered" for empty array', () => {
    expect(formatDiscoveredWorkers([])).toBe('No workers discovered');
  });
  
  it('should format single worker with VRAM', () => {
    const workers = [{ hostname: 'MacBook-Pro', ip: '192.168.1.10', vramGB: 8 }];
    expect(formatDiscoveredWorkers(workers)).toBe('MacBook-Pro (192.168.1.10 · 8 GB VRAM)');
  });
  
  it('should format CPU-only worker (0 VRAM)', () => {
    const workers = [{ hostname: 'ThinkPad', ip: '192.168.1.11', vramGB: 0 }];
    expect(formatDiscoveredWorkers(workers)).toBe('ThinkPad (192.168.1.11 · CPU)');
  });
  
  it('should format multiple workers with comma separator', () => {
    const workers = [
      { hostname: 'Worker-A', ip: '192.168.1.10', vramGB: 16 },
      { hostname: 'Worker-B', ip: '192.168.1.11', vramGB: 8 },
      { hostname: 'Worker-C', ip: '192.168.1.12', vramGB: 0 }
    ];
    const result = formatDiscoveredWorkers(workers);
    expect(result).toBe('Worker-A (192.168.1.10 · 16 GB VRAM), Worker-B (192.168.1.11 · 8 GB VRAM), Worker-C (192.168.1.12 · CPU)');
  });
});

describe('getConfigPath', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });
  
  it('should return macOS path on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.HOME = '/Users/test';
    
    const configPath = getConfigPath();
    expect(configPath).toContain('Library/Application Support/rpc-cluster');
  });
  
  it('should return Windows path on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    
    const configPath = getConfigPath();
    expect(configPath).toContain('rpc-cluster');
  });
  
  it('should return Linux path on other platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.HOME = '/home/test';
    
    const configPath = getConfigPath();
    expect(configPath).toContain('.config/rpc-cluster');
  });
});
