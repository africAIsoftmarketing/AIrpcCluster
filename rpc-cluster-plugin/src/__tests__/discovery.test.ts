import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dgram from 'dgram';
import { EventEmitter } from 'events';

// Mock dgram before importing the module under test
vi.mock('dgram');

// Import after mocking
import { discoverWorkers, buildRpcArgument, DISCOVERY_PORT } from '../discovery';

describe('discoverWorkers', () => {
  let mockSocket: EventEmitter & {
    bind: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setBroadcast: ReturnType<typeof vi.fn>;
    address: ReturnType<typeof vi.fn>;
  };
  
  beforeEach(() => {
    vi.useFakeTimers();
    
    mockSocket = Object.assign(new EventEmitter(), {
      bind: vi.fn(),
      close: vi.fn(),
      setBroadcast: vi.fn(),
      address: vi.fn().mockReturnValue({ port: DISCOVERY_PORT })
    });
    
    vi.mocked(dgram.createSocket).mockReturnValue(mockSocket as unknown as dgram.Socket);
  });
  
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  
  it('should return empty array when no workers are discovered', async () => {
    const promise = discoverWorkers(1000);
    
    // Emit listening event
    mockSocket.emit('listening');
    
    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(1100);
    
    const workers = await promise;
    expect(workers).toEqual([]);
    expect(mockSocket.close).toHaveBeenCalled();
  });
  
  it('should discover and return valid workers', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('listening');
    
    // Simulate receiving valid beacon
    const validBeacon = JSON.stringify({
      hostname: 'worker-1',
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    });
    
    mockSocket.emit('message', Buffer.from(validBeacon), { address: '192.168.1.10' });
    
    await vi.advanceTimersByTimeAsync(2100);
    
    const workers = await promise;
    expect(workers).toHaveLength(1);
    expect(workers[0]).toEqual({
      hostname: 'worker-1',
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    });
  });
  
  it('should deduplicate workers by IP address', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('listening');
    
    // Send same worker twice
    const beacon = JSON.stringify({
      hostname: 'worker-1',
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    });
    
    mockSocket.emit('message', Buffer.from(beacon), { address: '192.168.1.10' });
    mockSocket.emit('message', Buffer.from(beacon), { address: '192.168.1.10' });
    
    await vi.advanceTimersByTimeAsync(2100);
    
    const workers = await promise;
    expect(workers).toHaveLength(1);
  });
  
  it('should sort workers by VRAM descending', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('listening');
    
    // Send workers with different VRAM amounts
    const worker1 = JSON.stringify({
      hostname: 'low-vram',
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 4,
      platform: 'darwin'
    });
    
    const worker2 = JSON.stringify({
      hostname: 'high-vram',
      ip: '192.168.1.11',
      port: 50052,
      vramGB: 16,
      platform: 'darwin'
    });
    
    const worker3 = JSON.stringify({
      hostname: 'mid-vram',
      ip: '192.168.1.12',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    });
    
    mockSocket.emit('message', Buffer.from(worker1), { address: '192.168.1.10' });
    mockSocket.emit('message', Buffer.from(worker2), { address: '192.168.1.11' });
    mockSocket.emit('message', Buffer.from(worker3), { address: '192.168.1.12' });
    
    await vi.advanceTimersByTimeAsync(2100);
    
    const workers = await promise;
    expect(workers).toHaveLength(3);
    expect(workers[0].vramGB).toBe(16);
    expect(workers[1].vramGB).toBe(8);
    expect(workers[2].vramGB).toBe(4);
  });
  
  it('should silently ignore malformed JSON packets', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('listening');
    
    // Send malformed JSON
    mockSocket.emit('message', Buffer.from('not valid json'), { address: '192.168.1.10' });
    mockSocket.emit('message', Buffer.from('{incomplete'), { address: '192.168.1.11' });
    
    // Send valid beacon after malformed ones
    const validBeacon = JSON.stringify({
      hostname: 'worker-1',
      ip: '192.168.1.12',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    });
    mockSocket.emit('message', Buffer.from(validBeacon), { address: '192.168.1.12' });
    
    await vi.advanceTimersByTimeAsync(2100);
    
    const workers = await promise;
    expect(workers).toHaveLength(1);
    expect(workers[0].hostname).toBe('worker-1');
  });
  
  it('should ignore payloads with missing required fields', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('listening');
    
    // Missing hostname
    mockSocket.emit('message', Buffer.from(JSON.stringify({
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    })), { address: '192.168.1.10' });
    
    // Missing port
    mockSocket.emit('message', Buffer.from(JSON.stringify({
      hostname: 'worker',
      ip: '192.168.1.11',
      vramGB: 8,
      platform: 'darwin'
    })), { address: '192.168.1.11' });
    
    // Invalid port
    mockSocket.emit('message', Buffer.from(JSON.stringify({
      hostname: 'worker',
      ip: '192.168.1.12',
      port: -1,
      vramGB: 8,
      platform: 'darwin'
    })), { address: '192.168.1.12' });
    
    await vi.advanceTimersByTimeAsync(2100);
    
    const workers = await promise;
    expect(workers).toHaveLength(0);
  });
  
  it('should handle socket errors gracefully', async () => {
    const promise = discoverWorkers(2000);
    
    mockSocket.emit('error', new Error('Socket error'));
    
    const workers = await promise;
    expect(workers).toEqual([]);
  });
});

describe('buildRpcArgument', () => {
  it('should return empty string for empty worker list', () => {
    expect(buildRpcArgument([])).toBe('');
  });
  
  it('should format single worker correctly', () => {
    const workers = [{
      hostname: 'worker-1',
      ip: '192.168.1.10',
      port: 50052,
      vramGB: 8,
      platform: 'darwin'
    }];
    expect(buildRpcArgument(workers)).toBe('192.168.1.10:50052');
  });
  
  it('should format multiple workers with comma separator', () => {
    const workers = [
      { hostname: 'w1', ip: '192.168.1.10', port: 50052, vramGB: 16, platform: 'darwin' },
      { hostname: 'w2', ip: '192.168.1.11', port: 50052, vramGB: 8, platform: 'win32' },
      { hostname: 'w3', ip: '192.168.1.12', port: 50052, vramGB: 4, platform: 'linux' }
    ];
    expect(buildRpcArgument(workers)).toBe('192.168.1.10:50052,192.168.1.11:50052,192.168.1.12:50052');
  });
});
