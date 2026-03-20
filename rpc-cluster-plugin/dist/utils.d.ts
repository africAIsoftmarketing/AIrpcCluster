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
export declare function waitForPort(port: number, timeoutMs: number, pollIntervalMs?: number): Promise<void>;
/**
 * Gets the first non-loopback IPv4 address of this machine
 *
 * @returns Local IP address string, or '127.0.0.1' if none found
 */
export declare function getLocalIP(): string;
/**
 * Converts LM Studio Chat history to OpenAI message format
 *
 * @param history - LM Studio Chat history object
 * @returns Array of OpenAI-compatible messages
 */
export declare function toOpenAIMessages(history: Chat): OpenAIMessage[];
/**
 * Checks if a command exists in PATH
 *
 * @param command - Command name to check
 * @returns Promise resolving to true if command exists
 */
export declare function commandExists(command: string): Promise<boolean>;
/**
 * Checks if a port is currently in use
 *
 * @param port - Port number to check
 * @returns Promise resolving to true if port is in use
 */
export declare function isPortInUse(port: number): Promise<boolean>;
//# sourceMappingURL=utils.d.ts.map