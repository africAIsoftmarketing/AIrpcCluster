"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate = generate;
exports.testCluster = testCluster;
const child_process_1 = require("child_process");
const openai_1 = __importDefault(require("openai"));
const discovery_1 = require("./discovery");
const config_1 = require("./config");
const utils_1 = require("./utils");
/**
 * Port used by llama-server for OpenAI-compatible API
 */
const LLAMA_SERVER_PORT = 18080;
/**
 * Maximum time to wait for llama-server to start (ms)
 */
const LLAMA_SERVER_STARTUP_TIMEOUT = 30000;
/**
 * Module-level variable to track the llama-server process
 * This ensures only one instance runs per plugin session
 */
let llamaServerProcess = null;
let currentRpcConfig = null;
let isServerStarting = false;
/**
 * Cleanup handler for process exit
 */
function setupCleanupHandler() {
    const cleanup = () => {
        if (llamaServerProcess) {
            console.log('[generator] Cleaning up llama-server process...');
            llamaServerProcess.kill('SIGTERM');
            llamaServerProcess = null;
        }
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', cleanup);
}
setupCleanupHandler();
/**
 * Spawns llama-server with the given configuration
 */
async function spawnLlamaServer(config, workers, ctl) {
    const rpcArg = workers.length > 0 ? (0, discovery_1.buildRpcArgument)(workers) : '';
    // Check if we already have a server running with the same config
    if (llamaServerProcess && currentRpcConfig === rpcArg) {
        const inUse = await (0, utils_1.isPortInUse)(LLAMA_SERVER_PORT);
        if (inUse) {
            ctl.statusUpdate('Reusing existing llama-server instance');
            return;
        }
        // Process died, need to restart
        llamaServerProcess = null;
        currentRpcConfig = null;
    }
    // Guard against race conditions when generate() is called rapidly
    if (isServerStarting) {
        ctl.statusUpdate('Waiting for server to start...');
        // Wait for the existing startup to complete
        await (0, utils_1.waitForPort)(LLAMA_SERVER_PORT, LLAMA_SERVER_STARTUP_TIMEOUT);
        return;
    }
    // Kill existing process if config changed
    if (llamaServerProcess) {
        ctl.statusUpdate('Worker configuration changed, restarting llama-server...');
        llamaServerProcess.kill('SIGTERM');
        llamaServerProcess = null;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // Check if llama-server is in PATH
    const hasLlamaServer = await (0, utils_1.commandExists)('llama-server');
    if (!hasLlamaServer) {
        const errorMsg = 'llama-server not found in PATH. Please install llama.cpp and ensure ' +
            'llama-server is accessible from your system PATH. Visit ' +
            'https://github.com/ggerganov/llama.cpp for installation instructions.';
        ctl.statusUpdate(errorMsg);
        throw new Error(errorMsg);
    }
    // Build command arguments
    const args = [
        '-m', config.modelPath,
        '--port', LLAMA_SERVER_PORT.toString(),
        '-ngl', config.nGpuLayers.toString(),
        '--log-disable'
    ];
    if (rpcArg) {
        args.push('--rpc', rpcArg);
        ctl.statusUpdate(`Starting llama-server with ${workers.length} RPC worker(s)...`);
    }
    else {
        ctl.statusUpdate('Starting llama-server in local mode (no workers found)...');
    }
    isServerStarting = true;
    // Spawn the process
    try {
        llamaServerProcess = (0, child_process_1.spawn)('llama-server', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false
        });
    }
    catch (err) {
        isServerStarting = false;
        const error = err;
        if (error.code === 'ENOENT') {
            const errorMsg = 'llama-server not found. Please ensure llama-server is installed and in your PATH.';
            ctl.statusUpdate(errorMsg);
            throw new Error(errorMsg);
        }
        throw err;
    }
    currentRpcConfig = rpcArg;
    // Log stdout/stderr for debugging
    llamaServerProcess.stdout?.on('data', (data) => {
        console.log(`[llama-server] ${data.toString().trim()}`);
    });
    llamaServerProcess.stderr?.on('data', (data) => {
        console.error(`[llama-server] ${data.toString().trim()}`);
    });
    llamaServerProcess.on('error', (err) => {
        console.error('[generator] Failed to start llama-server:', err);
        const error = err;
        if (error.code === 'ENOENT') {
            ctl.statusUpdate('llama-server not found. Please ensure it is installed and in your PATH.');
        }
        llamaServerProcess = null;
        currentRpcConfig = null;
        isServerStarting = false;
    });
    llamaServerProcess.on('exit', (code, signal) => {
        console.log(`[generator] llama-server exited with code ${code}, signal ${signal}`);
        llamaServerProcess = null;
        currentRpcConfig = null;
        isServerStarting = false;
    });
    // Wait for the server to be ready
    ctl.statusUpdate('Waiting for llama-server to initialize...');
    try {
        await (0, utils_1.waitForPort)(LLAMA_SERVER_PORT, LLAMA_SERVER_STARTUP_TIMEOUT);
        isServerStarting = false;
        ctl.statusUpdate('llama-server ready');
    }
    catch (err) {
        isServerStarting = false;
        if (llamaServerProcess) {
            llamaServerProcess.kill('SIGTERM');
            llamaServerProcess = null;
        }
        throw new Error(`llama-server failed to start within ${LLAMA_SERVER_STARTUP_TIMEOUT / 1000} seconds. ` +
            'Check that the model path is correct and the model file exists.');
    }
}
/**
 * Main generator function - implements the LM Studio Generator interface
 *
 * @param ctl - Generator controller for output and status updates
 * @param history - Chat history from LM Studio
 */
async function generate(ctl, history) {
    // Step 1: Load configuration
    let config;
    try {
        config = (0, config_1.loadConfig)();
    }
    catch (err) {
        const error = err;
        ctl.statusUpdate(`Configuration error: ${error.message}`);
        throw error;
    }
    if (!config.modelPath) {
        throw new Error('Model path not configured. Please set the model path in the plugin configuration.');
    }
    // Step 2: Discover workers on the network
    ctl.statusUpdate('Discovering workers on the network...');
    let workers;
    try {
        workers = await (0, discovery_1.discoverWorkers)(config.discoveryTimeoutMs);
    }
    catch (err) {
        console.error('[generator] Discovery failed:', err);
        workers = [];
    }
    // Update the discovered workers display
    const workersDisplay = (0, config_1.formatDiscoveredWorkers)(workers);
    ctl.setConfig('discoveredWorkers', workersDisplay);
    if (workers.length === 0) {
        ctl.statusUpdate('No workers found - using local inference only');
    }
    else {
        ctl.statusUpdate(`Found ${workers.length} worker(s): ${workersDisplay}`);
    }
    // Step 3: Start or reuse llama-server
    try {
        await spawnLlamaServer(config, workers, ctl);
    }
    catch (err) {
        const error = err;
        ctl.statusUpdate(`Server error: ${error.message}`);
        throw error;
    }
    // Step 4: Create OpenAI client pointing to local llama-server
    const openai = new openai_1.default({
        baseURL: `http://127.0.0.1:${LLAMA_SERVER_PORT}/v1`,
        apiKey: 'not-needed' // llama-server doesn't require auth
    });
    // Step 5: Convert chat history to OpenAI format
    const messages = (0, utils_1.toOpenAIMessages)(history);
    // Step 6: Stream the completion
    ctl.statusUpdate('Generating response...');
    try {
        const stream = await openai.chat.completions.create({
            model: 'local', // llama-server ignores this but it's required
            messages: messages,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            stream: true
        });
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                ctl.write(delta);
            }
        }
        ctl.statusUpdate('Generation complete');
    }
    catch (err) {
        const error = err;
        ctl.statusUpdate(`Generation error: ${error.message}`);
        throw error;
    }
}
/**
 * Test cluster function - spawns server, sends test request, reports timing
 *
 * @param ctl - Generator controller for output and status updates
 * @returns Test result with response and timing
 */
async function testCluster(ctl) {
    const startTime = Date.now();
    // Load configuration
    let config;
    try {
        config = (0, config_1.loadConfig)();
    }
    catch (err) {
        const error = err;
        return { success: false, error: error.message, workerCount: 0 };
    }
    if (!config.modelPath) {
        return { success: false, error: 'Model path not configured', workerCount: 0 };
    }
    // Discover workers
    ctl.statusUpdate('Discovering workers...');
    let workers;
    try {
        workers = await (0, discovery_1.discoverWorkers)(config.discoveryTimeoutMs);
    }
    catch (err) {
        workers = [];
    }
    ctl.statusUpdate(`Found ${workers.length} worker(s), starting server...`);
    // Start server
    try {
        await spawnLlamaServer(config, workers, ctl);
    }
    catch (err) {
        const error = err;
        return { success: false, error: error.message, workerCount: workers.length };
    }
    // Create client and send test request
    const openai = new openai_1.default({
        baseURL: `http://127.0.0.1:${LLAMA_SERVER_PORT}/v1`,
        apiKey: 'not-needed'
    });
    ctl.statusUpdate('Sending test prompt...');
    try {
        const completion = await openai.chat.completions.create({
            model: 'local',
            messages: [{ role: 'user', content: 'Say hello in one word' }],
            max_tokens: 10,
            temperature: 0.1
        });
        const response = completion.choices[0]?.message?.content || '';
        const timeMs = Date.now() - startTime;
        // Kill the server after test
        if (llamaServerProcess) {
            llamaServerProcess.kill('SIGTERM');
            llamaServerProcess = null;
            currentRpcConfig = null;
        }
        return {
            success: true,
            response: response.trim(),
            timeMs,
            workerCount: workers.length
        };
    }
    catch (err) {
        const error = err;
        // Kill the server on error
        if (llamaServerProcess) {
            llamaServerProcess.kill('SIGTERM');
            llamaServerProcess = null;
            currentRpcConfig = null;
        }
        return {
            success: false,
            error: error.message,
            workerCount: workers.length
        };
    }
}
// Export for LM Studio plugin system
exports.default = { generate, testCluster };
//# sourceMappingURL=generator.js.map