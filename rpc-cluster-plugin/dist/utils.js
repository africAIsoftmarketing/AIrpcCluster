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
exports.waitForPort = waitForPort;
exports.getLocalIP = getLocalIP;
exports.toOpenAIMessages = toOpenAIMessages;
exports.commandExists = commandExists;
exports.isPortInUse = isPortInUse;
const net = __importStar(require("net"));
const os = __importStar(require("os"));
/**
 * Waits for a TCP port to become available
 *
 * @param port - Port number to check
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check (default: 500ms)
 * @returns Promise that resolves when port is available, rejects on timeout
 */
function waitForPort(port, timeoutMs, pollIntervalMs = 500) {
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
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const addrs = interfaces[name];
        if (!addrs)
            continue;
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
function toOpenAIMessages(history) {
    return history.messages.map((msg) => {
        let role;
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
function commandExists(command) {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        const checkCmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
        exec(checkCmd, (error) => {
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
function isPortInUse(port) {
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
//# sourceMappingURL=utils.js.map