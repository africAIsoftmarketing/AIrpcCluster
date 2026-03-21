import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { EventEmitter } from 'events';

// Import functions to test
import { waitForPort, getLocalIP, toOpenAIMessages, isPortInUse } from '../utils.js';

describe('waitForPort', () => {
  it('should resolve when port becomes available', async () => {
    // Use a port that's definitely not in use
    const testPort = 59999;
    
    // Start a server after a short delay
    const server = net.createServer();
    
    setTimeout(() => {
      server.listen(testPort, '127.0.0.1');
    }, 100);
    
    try {
      await waitForPort(testPort, 2000, 50);
      // If we get here, port was detected
      expect(true).toBe(true);
    } finally {
      server.close();
    }
  }, 5000);
  
  it('should reject on timeout when port never opens', async () => {
    // Use a port that's definitely not in use
    const testPort = 59998;
    
    await expect(waitForPort(testPort, 200, 50)).rejects.toThrow('Timeout waiting for port');
  }, 5000);
});

describe('getLocalIP', () => {
  it('should return a valid IP address', () => {
    const ip = getLocalIP();
    
    // Should be either a real IP or fallback
    expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });
  
  it('should return an IPv4 address', () => {
    const ip = getLocalIP();
    // Should be a valid IPv4 format
    const parts = ip.split('.');
    expect(parts.length).toBe(4);
    parts.forEach(part => {
      const num = parseInt(part, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(255);
    });
  });
});

describe('toOpenAIMessages', () => {
  it('should convert user messages', () => {
    const chat = {
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'user', content: 'Hello' }
    ]);
  });
  
  it('should convert system messages', () => {
    const chat = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'system', content: 'You are a helpful assistant' }
    ]);
  });
  
  it('should convert assistant messages', () => {
    const chat = {
      messages: [
        { role: 'assistant', content: 'Hi there!' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'assistant', content: 'Hi there!' }
    ]);
  });
  
  it('should map bot/ai roles to assistant', () => {
    const chat = {
      messages: [
        { role: 'bot', content: 'Bot message' },
        { role: 'ai', content: 'AI message' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'assistant', content: 'Bot message' },
      { role: 'assistant', content: 'AI message' }
    ]);
  });
  
  it('should map human role to user', () => {
    const chat = {
      messages: [
        { role: 'human', content: 'Human message' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'user', content: 'Human message' }
    ]);
  });
  
  it('should default unknown roles to user', () => {
    const chat = {
      messages: [
        { role: 'unknown', content: 'Unknown role message' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([
      { role: 'user', content: 'Unknown role message' }
    ]);
  });
  
  it('should handle complete conversation', () => {
    const chat = {
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am doing well!' }
      ]
    };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
    expect(result[2].role).toBe('assistant');
    expect(result[3].role).toBe('user');
    expect(result[4].role).toBe('assistant');
  });
  
  it('should handle empty message array', () => {
    const chat = { messages: [] };
    
    const result = toOpenAIMessages(chat);
    
    expect(result).toEqual([]);
  });
});

describe('isPortInUse', () => {
  it('should return true when port is in use', async () => {
    const testPort = 59997;
    const server = net.createServer();
    
    await new Promise<void>((resolve) => {
      server.listen(testPort, '127.0.0.1', () => resolve());
    });
    
    try {
      const result = await isPortInUse(testPort);
      expect(result).toBe(true);
    } finally {
      server.close();
    }
  }, 5000);
  
  it('should return false when port is not in use', async () => {
    const testPort = 59996;
    const result = await isPortInUse(testPort);
    expect(result).toBe(false);
  }, 5000);
});
