import * as net from 'net';
import * as os from 'os';

/**
 * OpenAI-compatible message format
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LM Studio Chat message format (simplified)
 */
export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * LM Studio Chat history format (simplified)
 */
export interface Chat {
  messages: ChatMessage[];
}

/**
 * Waits for a TCP port to become available
 * 
 * @param port - Port number to check
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check (default: 500ms)
 * @returns Promise that resolves when port is available, rejects on timeout
 */
export function waitForPort(
  port: number,
  timeoutMs: number,
  pollIntervalMs: number = 500
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkPort = () => {
      const socket = new net.Socket();
      let resolved = false;
      
      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };
      
      socket.setTimeout(pollIntervalMs);
      
      socket.on('connect', () => {
        resolved = true;
        cleanup();
        resolve();
      });
      
      socket.on('error', () => {
        cleanup();
        if (!resolved) {
          scheduleNextCheck();
        }
      });
      
      socket.on('timeout', () => {
        cleanup();
        if (!resolved) {
          scheduleNextCheck();
        }
      });
      
      socket.connect(port, '127.0.0.1');
    };
    
    const scheduleNextCheck = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port} after ${timeoutMs}ms`));
        return;
      }
      setTimeout(checkPort, pollIntervalMs);
    };
    
    checkPort();
  });
}

/**
 * Gets the first non-loopback IPv4 address of this machine
 * 
 * @returns Local IP address string, or '127.0.0.1' if none found
 */
export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  
  return '127.0.0.1';
}

/**
 * Converts LM Studio Chat history to OpenAI message format
 * 
 * @param history - LM Studio Chat history object
 * @returns Array of OpenAI-compatible messages
 */
export function toOpenAIMessages(history: Chat): OpenAIMessage[] {
  return history.messages.map((msg) => {
    let role: 'system' | 'user' | 'assistant';
    
    switch (msg.role.toLowerCase()) {
      case 'system':
        role = 'system';
        break;
      case 'assistant':
      case 'bot':
      case 'ai':
        role = 'assistant';
        break;
      case 'user':
      case 'human':
      default:
        role = 'user';
        break;
    }
    
    return {
      role,
      content: msg.content
    };
  });
}

/**
 * Checks if a command exists in PATH
 * 
 * @param command - Command name to check
 * @returns Promise resolving to true if command exists
 */
export function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    
    exec(checkCmd, (error: Error | null) => {
      resolve(!error);
    });
  });
}

/**
 * Checks if a port is currently in use
 * 
 * @param port - Port number to check
 * @returns Promise resolving to true if port is in use
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    socket.setTimeout(1000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, '127.0.0.1');
  });
}
