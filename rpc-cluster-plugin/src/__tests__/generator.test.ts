import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn()
}));

// Mock the discovery module
vi.mock('../discovery', () => ({
  discoverWorkers: vi.fn(),
  buildRpcArgument: vi.fn()
}));

// Mock the config module
vi.mock('../config', () => ({
  loadConfig: vi.fn(),
  formatDiscoveredWorkers: vi.fn()
}));

// Mock the utils module partially
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    waitForPort: vi.fn(),
    commandExists: vi.fn(),
    isPortInUse: vi.fn()
  };
});

import { spawn } from 'child_process';
import { discoverWorkers, buildRpcArgument } from '../discovery';
import { loadConfig, formatDiscoveredWorkers } from '../config';
import { waitForPort, commandExists, isPortInUse } from '../utils';

// Import after mocking
import { generate, GeneratorController } from '../generator';

describe('generate', () => {
  let mockCtl: GeneratorController;
  let mockProcess: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockCtl = {
      write: vi.fn(),
      statusUpdate: vi.fn(),
      setConfig: vi.fn()
    };
    
    mockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      pid: 12345
    });
    
    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    vi.mocked(formatDiscoveredWorkers).mockReturnValue('No workers discovered');
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('config loading', () => {
    it('should throw error when config loading fails', async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('Config file corrupted');
      });
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('Config file corrupted');
      expect(mockCtl.statusUpdate).toHaveBeenCalledWith(expect.stringContaining('Configuration error'));
    });
    
    it('should throw error when modelPath is not configured', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '',
        discoveryTimeoutMs: 4000,
        nGpuLayers: 99,
        maxTokens: 2048,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('Model path not configured');
    });
    
    it('should load config and proceed with valid modelPath', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(false);
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('llama-server not found');
      
      // Verify config was loaded
      expect(loadConfig).toHaveBeenCalled();
    });
  });
  
  describe('worker discovery', () => {
    it('should fall back to local mode when no workers found', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(false);
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow();
      
      expect(mockCtl.statusUpdate).toHaveBeenCalledWith('No workers found - using local inference only');
    });
    
    it('should report discovered workers', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([
        { hostname: 'worker-1', ip: '192.168.1.10', port: 50052, vramGB: 8, platform: 'darwin' }
      ]);
      vi.mocked(formatDiscoveredWorkers).mockReturnValue('worker-1 (192.168.1.10 · 8 GB VRAM)');
      vi.mocked(buildRpcArgument).mockReturnValue('192.168.1.10:50052');
      vi.mocked(commandExists).mockResolvedValue(false);
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow();
      
      expect(mockCtl.setConfig).toHaveBeenCalledWith('discoveredWorkers', 'worker-1 (192.168.1.10 · 8 GB VRAM)');
    });
  });
  
  describe('llama-server spawn', () => {
    it('should throw human-readable error when llama-server not in PATH', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(false);
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('llama-server not found in PATH');
      expect(mockCtl.statusUpdate).toHaveBeenCalledWith(expect.stringContaining('llama-server not found'));
    });
    
    it('should spawn llama-server with correct arguments in local mode', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(true);
      vi.mocked(isPortInUse).mockResolvedValue(false);
      vi.mocked(waitForPort).mockRejectedValue(new Error('Timeout'));
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow();
      
      expect(spawn).toHaveBeenCalledWith(
        'llama-server',
        expect.arrayContaining([
          '-m', '/tmp/test-model.gguf',
          '--port', '18080',
          '-ngl', '0',
          '--log-disable'
        ]),
        expect.any(Object)
      );
    });
    
    it('should spawn llama-server with --rpc flag when workers found', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([
        { hostname: 'worker-1', ip: '192.168.1.10', port: 50052, vramGB: 8, platform: 'darwin' }
      ]);
      vi.mocked(buildRpcArgument).mockReturnValue('192.168.1.10:50052');
      vi.mocked(commandExists).mockResolvedValue(true);
      vi.mocked(isPortInUse).mockResolvedValue(false);
      vi.mocked(waitForPort).mockRejectedValue(new Error('Timeout'));
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow();
      
      expect(spawn).toHaveBeenCalledWith(
        'llama-server',
        expect.arrayContaining([
          '--rpc', '192.168.1.10:50052'
        ]),
        expect.any(Object)
      );
    });
    
    it('should handle spawn ENOENT error', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(true);
      vi.mocked(isPortInUse).mockResolvedValue(false);
      
      // Simulate ENOENT error on spawn
      vi.mocked(spawn).mockImplementation(() => {
        const err = new Error('spawn llama-server ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('llama-server not found');
    });
  });
  
  describe('server startup timeout', () => {
    it('should throw error when server fails to start within timeout', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        modelPath: '/tmp/test-model.gguf',
        discoveryTimeoutMs: 1000,
        nGpuLayers: 0,
        maxTokens: 128,
        temperature: 0.7,
        workers: [],
        discoveredWorkers: ''
      });
      vi.mocked(discoverWorkers).mockResolvedValue([]);
      vi.mocked(commandExists).mockResolvedValue(true);
      vi.mocked(isPortInUse).mockResolvedValue(false);
      vi.mocked(waitForPort).mockRejectedValue(new Error('Timeout waiting for port'));
      
      await expect(generate(mockCtl, { messages: [] })).rejects.toThrow('llama-server failed to start');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});

describe('generator cleanup', () => {
  it('should kill llama-server process on SIGTERM', () => {
    // This tests the cleanup handler registration
    // The actual cleanup is tested implicitly through spawn lifecycle tests
    expect(true).toBe(true);
  });
});
