const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const net = require('net');
const { discoverWorkers, probeCloudWorker, scanCloudWorkers, CONFIG_PATH } = require('./shared/discovery');

let mainWindow = null;
const inferenceProcesses = new Map();
const serverLogs = new Map(); // Store logs per model
const MAX_LOG_LINES = 500; // Maximum lines to keep per model
let appModels = [];
let appWorkers = [];

/**
 * Get LM Studio models directory based on platform
 */
function getModelsDirectory() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'LM Studio', 'models');
  } else {
    return path.join(os.homedir(), '.lmstudio', 'models');
  }
}

/**
 * Recursively find all .gguf files in a directory
 */
function findGgufFiles(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findGgufFiles(fullPath, files);
      } else if (entry.name.endsWith('.gguf')) {
        const stats = fs.statSync(fullPath);
        const sizeGB = Math.round(stats.size / 1e9 * 10) / 10;
        files.push({
          name: entry.name.replace('.gguf', ''),
          path: fullPath,
          sizeGB: sizeGB
        });
      }
    }
  } catch (err) {
    console.error('Error scanning directory:', err);
  }
  
  return files;
}

/**
 * Wait for a port to become available
 */
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkPort = () => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      
      socket.on('error', () => {
        socket.destroy();
        scheduleNextCheck();
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        scheduleNextCheck();
      });
      
      socket.connect(port, '127.0.0.1');
    };
    
    const scheduleNextCheck = () => {
      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port}`));
        return;
      }
      setTimeout(checkPort, 500);
    };
    
    checkPort();
  });
}

/**
 * Create the main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 680,
    resizable: true,
    title: 'RPC Cluster Configurator',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  for (const [id, proc] of inferenceProcesses) {
    try { proc.kill('SIGTERM'); } catch (e) {}
  }
  inferenceProcesses.clear();
});

// IPC Handlers

ipcMain.handle('scan-workers', async () => {
  try {
    const workers = await discoverWorkers(4000);
    return workers;
  } catch (err) {
    return { error: err.message };
  }
});

// Probe a single cloud worker by IP:port (TCP direct, no UDP broadcast needed)
ipcMain.handle('probe-cloud-worker', async (event, { ip, port }) => {
  try {
    const worker = await probeCloudWorker(ip, port || 50052, 6000);
    return worker ? { ok: true, worker } : { ok: false, error: `Port ${port || 50052} unreachable at ${ip}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Probe multiple cloud workers in parallel
ipcMain.handle('scan-cloud-workers', async (event, targets) => {
  try {
    const workers = await scanCloudWorkers(targets, 6000);
    return workers;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('list-models', async () => {
  try {
    const modelsDir = getModelsDirectory();
    const models = findGgufFiles(modelsDir);
    return models;
  } catch (err) {
    return [];
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    if (config.workers) {
      appWorkers = config.workers;
    }
    persistConfig();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-config', async () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { version: 2, workers: [], models: [] };
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    let config = JSON.parse(content);
    config = migrateConfig(config);
    config.models.forEach(m => { m.status = 'stopped'; });
    appModels = config.models;
    appWorkers = config.workers;
    return config;
  } catch (err) {
    return { version: 2, workers: [], models: [] };
  }
});

ipcMain.handle('open-config-folder', async () => {
  try {
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    await shell.openPath(configDir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('test-cluster', async (event, config) => {
  const TEST_PORT = 18090;
  let serverProcess = null;
  
  try {
    // Build arguments
    const args = [
      '-m', config.modelPath,
      '--port', TEST_PORT.toString(),
      '-ngl', (config.nGpuLayers || 99).toString(),
      '--log-disable'
    ];
    
    // Add RPC workers if any are enabled
    const enabledWorkers = (config.workers || []).filter(w => w.enabled);
    if (enabledWorkers.length > 0) {
      const rpcArg = enabledWorkers.map(w => `${w.ip}:${w.port}`).join(',');
      args.push('--rpc', rpcArg);
    }
    
    const startTime = Date.now();
    
    // Spawn llama-server
    try {
      serverProcess = spawn('llama-server', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {
          ok: false,
          error: 'llama-server not found in PATH. Install llama.cpp and ensure llama-server is accessible from your terminal.'
        };
      }
      throw err;
    }
    
    // Handle spawn errors
    let spawnError = null;
    serverProcess.on('error', (err) => {
      spawnError = err;
    });
    
    // Wait for server to be ready
    try {
      await waitForPort(TEST_PORT, 30000);
    } catch (err) {
      if (spawnError && spawnError.code === 'ENOENT') {
        return {
          ok: false,
          error: 'llama-server not found in PATH. Install llama.cpp and ensure llama-server is accessible from your terminal.'
        };
      }
      return {
        ok: false,
        error: `llama-server failed to start within 30 seconds. Make sure the model path is correct and the file exists.`
      };
    }
    
    // Send test request
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'local',
        stream: false,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say hello in one word' }]
      })
    });
    
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP error: ${response.status} ${response.statusText}`
      };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const durationMs = Date.now() - startTime;
    
    return {
      ok: true,
      response: content.trim(),
      durationMs: durationMs
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  } finally {
    // Always kill the server process
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch (e) {
        // Ignore kill errors
      }
    }
  }
});


/**
 * Load config from disk (shared helper for inference server)
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(content);
}

function migrateConfig(config) {
  if (config.version === 2) return config;
  return {
    version: 2,
    workers: config.workers ?? [],
    models: config.modelPath ? [{
      id: 'model-1',
      name: path.basename(config.modelPath, '.gguf'),
      modelPath: config.modelPath,
      port: 18080,
      nGpuLayers: config.nGpuLayers ?? 99,
      maxTokens: config.maxTokens ?? 2048,
      temperature: config.temperature ?? 0.7,
      enabled: true,
      status: 'stopped'
    }] : []
  };
}

function persistConfig() {
  try {
    const config = {
      version: 2,
      workers: appWorkers,
      models: appModels.map(m => ({ ...m, status: 'stopped' }))
    };
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[config] Failed to persist:', err.message);
  }
}

function getNextAvailablePort() {
  const usedPorts = new Set(appModels.map(m => m.port));
  usedPorts.add(18090);
  let port = 18080;
  while (usedPorts.has(port)) port++;
  return port;
}

// --- Multi-model management ---

ipcMain.handle('get-models', async () => {
  return appModels;
});

ipcMain.handle('add-model', async (event, modelData) => {
  const model = {
    id: `model-${Date.now()}`,
    name: modelData.name || path.basename(modelData.modelPath || '', '.gguf'),
    modelPath: (modelData.modelPath || '').trim().replace(/^["']|["']$/g, ''),
    port: getNextAvailablePort(),
    nGpuLayers: modelData.nGpuLayers ?? 99,
    maxTokens: modelData.maxTokens ?? 2048,
    temperature: modelData.temperature ?? 0.7,
    enabled: true,
    status: 'stopped'
  };
  if (modelData.port && modelData.port >= 1024 && modelData.port <= 65535) {
    model.port = modelData.port;
  }
  appModels.push(model);
  persistConfig();
  return model;
});

ipcMain.handle('update-model', async (event, { id, changes }) => {
  const model = appModels.find(m => m.id === id);
  if (!model) return { ok: false, error: 'Model not found' };
  if (changes.port !== undefined && inferenceProcesses.has(id)) {
    return { ok: false, error: 'Cannot change port while model is running. Stop the server first.' };
  }
  if (changes.modelPath) {
    changes.modelPath = changes.modelPath.trim().replace(/^["']|["']$/g, '');
  }
  Object.assign(model, changes);
  persistConfig();
  return { ok: true };
});

ipcMain.handle('remove-model', async (event, id) => {
  if (inferenceProcesses.has(id)) {
    try { inferenceProcesses.get(id).kill('SIGTERM'); } catch (e) {}
    inferenceProcesses.delete(id);
  }
  appModels = appModels.filter(m => m.id !== id);
  persistConfig();
  return { ok: true };
});

ipcMain.handle('start-model', async (event, id) => {
  const model = appModels.find(m => m.id === id);
  if (!model) return { ok: false, error: 'Model not found' };

  if (!model.modelPath || typeof model.modelPath !== 'string' || model.modelPath.trim() === '') {
    return { ok: false, error: 'Model path is not set. Edit the model configuration first.' };
  }
  if (!fs.existsSync(model.modelPath)) {
    return { ok: false, error: `Model file not found: ${model.modelPath}` };
  }

  // Kill existing process for this model if any
  if (inferenceProcesses.has(id)) {
    try { inferenceProcesses.get(id).kill('SIGTERM'); } catch (e) {}
    inferenceProcesses.delete(id);
  }

  // DLL pre-flight check (Windows)
  if (process.platform === 'win32') {
    const WIN_INSTALL_DIR = path.join('C:\\', 'llama-server');
    const REQUIRED_DLLS = ['ggml-base.dll', 'ggml.dll', 'llama.dll'];
    if (fs.existsSync(WIN_INSTALL_DIR)) {
      const files = fs.readdirSync(WIN_INSTALL_DIR);
      const missing = REQUIRED_DLLS.filter(dll => !files.includes(dll));
      if (missing.length > 0) {
        return {
          ok: false,
          error: `llama-server installation is incomplete. Missing: ${missing.join(', ')}. Go to Step 0 and click "Reinstall or repair".`
        };
      }
    }
  }

  // Resolve llama-server binary
  let llamaBinary = 'llama-server';
  try {
    const cmd = process.platform === 'win32' ? 'where llama-server' : 'which llama-server';
    execSync(cmd, { encoding: 'utf-8' });
  } catch (e) {
    const INSTALL_DIR = process.platform === 'win32'
      ? path.join('C:\\', 'llama-server')
      : '/usr/local/bin';
    const binaryName = process.platform === 'win32'
      ? 'llama-server.exe' : 'llama-server';
    const knownPath = path.join(INSTALL_DIR, binaryName);

    if (fs.existsSync(knownPath)) {
      llamaBinary = knownPath;
      // Inject into process.env.PATH for future calls
      if (!process.env.PATH.includes(INSTALL_DIR)) {
        process.env.PATH = process.env.PATH + path.delimiter + INSTALL_DIR;
      }
      console.log('[start-model] Using known path:', llamaBinary);
    } else {
      return { ok: false, error: 'llama-server not found. Complete the host setup in Step 0.' };
    }
  }

  const args = [
    '-m', model.modelPath,
    '--port', String(model.port),
    '-ngl', String(model.nGpuLayers || 99),
    '--log-disable',
  ];

  const enabledWorkers = appWorkers.filter(w => w.enabled);
  if (enabledWorkers.length > 0) {
    args.push('--rpc', enabledWorkers.map(w => `${w.ip}:${w.port}`).join(','));
  }

  let proc;
  try {
    proc = spawn(llamaBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: 'llama-server not found in PATH.' };
    }
    return { ok: false, error: err.message };
  }

  // Initialize log storage for this model
  serverLogs.set(id, []);

  // Helper to add log entry
  const addLog = (type, message) => {
    const logs = serverLogs.get(id) || [];
    const timestamp = new Date().toISOString().substr(11, 8);
    const entry = { timestamp, type, message };
    logs.push(entry);
    // Keep only last MAX_LOG_LINES
    if (logs.length > MAX_LOG_LINES) {
      logs.shift();
    }
    serverLogs.set(id, logs);
    // Send to renderer
    if (mainWindow) {
      mainWindow.webContents.send('server-log', { modelId: id, entry });
    }
  };

  // Capture stdout
  if (proc.stdout) {
    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => addLog('stdout', line));
    });
  }

  // Capture stderr
  if (proc.stderr) {
    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => addLog('stderr', line));
    });
  }

  addLog('info', `Starting llama-server on port ${model.port}...`);
  addLog('info', `Command: ${llamaBinary} ${args.join(' ')}`);

  let spawnError = null;
  proc.on('error', (err) => { 
    spawnError = err;
    addLog('error', `Process error: ${err.message}`);
  });
  proc.on('exit', (code, signal) => {
    inferenceProcesses.delete(id);
    const m = appModels.find(x => x.id === id);
    if (m) m.status = 'stopped';
    addLog('info', `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
  });

  inferenceProcesses.set(id, proc);

  try {
    await waitForPort(model.port, 30000);
  } catch (err) {
    try { proc.kill('SIGTERM'); } catch (e) {}
    inferenceProcesses.delete(id);
    if (spawnError && spawnError.code === 'ENOENT') {
      return { ok: false, error: 'llama-server not found in PATH.' };
    }
    return { ok: false, error: `llama-server did not start within 30 seconds on port ${model.port}. Check model path and available memory.` };
  }

  model.status = 'running';
  return {
    ok: true,
    url: `http://localhost:${model.port}/v1`,
    model: model.name,
    port: model.port
  };
});

ipcMain.handle('stop-model', async (event, id) => {
  if (inferenceProcesses.has(id)) {
    try { inferenceProcesses.get(id).kill('SIGTERM'); } catch (e) {}
    inferenceProcesses.delete(id);
  }
  const model = appModels.find(m => m.id === id);
  if (model) model.status = 'stopped';
  return { ok: true };
});

ipcMain.handle('stop-all-models', async () => {
  let stopped = 0;
  for (const [id, proc] of inferenceProcesses) {
    try { proc.kill('SIGTERM'); } catch (e) {}
    stopped++;
  }
  inferenceProcesses.clear();
  appModels.forEach(m => { m.status = 'stopped'; });
  return { ok: true, stopped };
});

ipcMain.handle('get-model-status', async (event, id) => {
  const model = appModels.find(m => m.id === id);
  if (!model) return { running: false, url: null, port: 0 };
  const running = inferenceProcesses.has(id);
  return {
    running,
    url: running ? `http://localhost:${model.port}/v1` : null,
    port: model.port
  };
});


// --- Host hardware detection ---

ipcMain.handle('detect-host-hardware', async () => {
  const result = {
    llamaServerFound: false,
    llamaServerPath: null,
    gpu: { type: 'cpu', name: null, vramGB: 0 },
    recommendedVariant: 'cpu',
    platform: process.platform,
  };

  // 1. Check if llama-server is already in PATH
  try {
    const cmd = process.platform === 'win32' ? 'where llama-server' : 'which llama-server';
    const found = execSync(cmd, { encoding: 'utf-8' }).trim();
    if (found) {
      result.llamaServerFound = true;
      result.llamaServerPath = found.split('\n')[0].trim();
    }
  } catch (e) {
    // Also check known install location
    const knownPath = process.platform === 'win32'
      ? path.join('C:\\', 'llama-server', 'llama-server.exe')
      : '/usr/local/bin/llama-server';
    if (fs.existsSync(knownPath)) {
      result.llamaServerFound = true;
      result.llamaServerPath = knownPath;
    }
  }

  // 2. Detect GPU on Windows
  if (process.platform === 'win32') {
    try {
      const output = execSync(
        'wmic path Win32_VideoController get Name,AdapterRAM /format:csv',
        { encoding: 'utf-8', timeout: 10000 }
      );
      const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
      for (const line of lines) {
        const parts = line.split(',');
        const ramBytes = parseInt(parts[1], 10);
        const name = parts[2]?.trim() ?? '';
        if (!name || name === 'Microsoft Basic Display Adapter') continue;
        const vramGB = Math.round(ramBytes / 1e9);
        if (name.match(/NVIDIA|GeForce|Quadro|Tesla/i)) {
          result.gpu = { type: 'nvidia', name, vramGB };
          try {
            const nvOut = execSync(
              'nvidia-smi --query-gpu=driver_version --format=csv,noheader',
              { encoding: 'utf-8', timeout: 5000 }
            ).trim();
            const driverMajor = parseInt(nvOut.split('.')[0], 10);
            result.recommendedVariant = driverMajor >= 525 ? 'cuda-cu12.4' : 'cuda-cu11.7';
          } catch {
            result.recommendedVariant = 'cuda-cu12.4';
          }
          break;
        } else if (name.match(/AMD|Radeon|RX\s/i)) {
          result.gpu = { type: 'amd', name, vramGB };
          result.recommendedVariant = 'vulkan';
          break;
        } else if (name.match(/Intel/i)) {
          result.gpu = { type: 'intel', name, vramGB };
          result.recommendedVariant = 'vulkan';
          break;
        }
      }
    } catch (e) {
      result.gpu = { type: 'cpu', name: null, vramGB: 0 };
      result.recommendedVariant = 'cpu';
    }
  }

  // 3. Detect GPU on macOS
  if (process.platform === 'darwin') {
    try {
      const output = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf-8', timeout: 10000 });
      const isAppleSilicon = output.match(/Apple M[0-9]/i) || process.arch === 'arm64';
      if (isAppleSilicon) {
        const ramMatch = output.match(/VRAM[^:]*:\s*(\d+)\s*(GB|MB)/i);
        const vramGB = ramMatch
          ? (ramMatch[2] === 'GB' ? parseInt(ramMatch[1]) : Math.floor(parseInt(ramMatch[1]) / 1024))
          : Math.floor(os.totalmem() / 1e9 * 0.75);
        result.gpu = { type: 'apple', name: 'Apple Silicon (Metal)', vramGB };
        result.recommendedVariant = 'metal';
      }
    } catch (e) {
      result.recommendedVariant = 'metal';
    }
  }

  // 4. Detect GPU on Linux
  if (process.platform === 'linux') {
    try {
      const lspci = execSync('lspci 2>/dev/null | grep -i vga', { encoding: 'utf-8', timeout: 5000 });
      if (lspci.match(/NVIDIA/i)) {
        result.gpu = { type: 'nvidia', name: lspci.trim().split(':').pop().trim(), vramGB: 0 };
        result.recommendedVariant = 'cuda-cu12.4';
      } else if (lspci.match(/AMD|Radeon/i)) {
        result.gpu = { type: 'amd', name: lspci.trim().split(':').pop().trim(), vramGB: 0 };
        result.recommendedVariant = 'vulkan';
      }
    } catch (e) {
      result.recommendedVariant = 'cpu';
    }
  }

  return result;
});

// --- llama.cpp download URL resolver ---

// Centralized asset name mapping - single place to update if GitHub changes naming
const ASSET_NAME_MAP = {
  win32: {
    'cpu':         (v) => `llama-${v}-bin-win-cpu-x64.zip`,
    'cuda-cu11.7': (v) => `llama-${v}-bin-win-cuda-11.7-x64.zip`,
    'cuda-cu12.4': (v) => `llama-${v}-bin-win-cuda-12.4-x64.zip`,
    'vulkan':      (v) => `llama-${v}-bin-win-vulkan-x64.zip`,
  },
  darwin: {
    'metal': (v) => `llama-${v}-bin-macos-arm64.zip`,
    'cpu':   (v) => `llama-${v}-bin-macos-x64.zip`,
  },
  linux: {
    'cpu':         (v) => `llama-${v}-bin-linux-x64.zip`,
    'cuda-cu12.4': (v) => `llama-${v}-bin-linux-cuda-12.4-x64.zip`,
    'vulkan':      (v) => `llama-${v}-bin-linux-vulkan-x64.zip`,
  }
};

// Build fuzzy search keywords from variant and platform
function buildAssetKeywords(variant, platform) {
  const keywords = [];
  
  // Platform keywords
  if (platform === 'win32') keywords.push('win');
  else if (platform === 'darwin') keywords.push('macos');
  else keywords.push('linux');
  
  // Architecture
  if (platform === 'darwin' && variant === 'metal') {
    keywords.push('arm64');
  } else {
    keywords.push('x64');
  }
  
  // Variant-specific keywords
  if (variant.includes('cuda')) {
    keywords.push('cuda');
    // Extract version number (e.g., '12.4' from 'cuda-cu12.4')
    const cudaMatch = variant.match(/(\d+\.\d+)/);
    if (cudaMatch) keywords.push(cudaMatch[1]);
  } else if (variant === 'vulkan') {
    keywords.push('vulkan');
  } else if (variant === 'metal') {
    // Metal is implicit in macos-arm64
  } else if (variant === 'cpu') {
    keywords.push('cpu');
  }
  
  return keywords;
}

ipcMain.handle('get-llama-download-url', async (event, variant) => {
  const https = require('https');
  const DEBUG = process.env.RPC_CLUSTER_DEBUG === '1';

  try {
    const releaseData = await new Promise((resolve, reject) => {
      https.get(
        'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest',
        { headers: { 'User-Agent': 'rpc-cluster-configurator' } },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(e); }
          });
        }
      ).on('error', reject);
    });

    const version = releaseData.tag_name;
    
    // Debug: log all available assets
    if (DEBUG) {
      console.log('[get-llama-download-url] Available assets:');
      releaseData.assets.forEach(a => console.log(`  - ${a.name}`));
    }

    // Get the asset name generator for this platform
    const platformMap = ASSET_NAME_MAP[process.platform] || ASSET_NAME_MAP.linux;
    const getAssetName = platformMap[variant] || platformMap['cpu'];
    const expectedFilename = getAssetName(version);

    if (DEBUG) {
      console.log(`[get-llama-download-url] Looking for: ${expectedFilename}`);
    }

    // Try exact match first
    let asset = releaseData.assets.find(a => a.name === expectedFilename);

    // Fallback 1: case-insensitive exact match
    if (!asset) {
      asset = releaseData.assets.find(a => 
        a.name.toLowerCase() === expectedFilename.toLowerCase()
      );
    }

    // Fallback 2: fuzzy match using keywords
    if (!asset) {
      const keywords = buildAssetKeywords(variant, process.platform);
      if (DEBUG) {
        console.log(`[get-llama-download-url] Fuzzy search with keywords: ${keywords.join(', ')}`);
      }
      
      asset = releaseData.assets.find(a => {
        const name = a.name.toLowerCase();
        // Must be a zip file
        if (!name.endsWith('.zip')) return false;
        // Must contain all keywords
        return keywords.every(kw => name.includes(kw.toLowerCase()));
      });
    }

    if (!asset) {
      // Build helpful error message with available assets
      const platformAssets = releaseData.assets
        .filter(a => a.name.endsWith('.zip'))
        .filter(a => {
          const name = a.name.toLowerCase();
          if (process.platform === 'win32') return name.includes('win');
          if (process.platform === 'darwin') return name.includes('macos');
          return name.includes('linux');
        })
        .map(a => a.name);
      
      const allAssets = releaseData.assets.filter(a => a.name.endsWith('.zip')).map(a => a.name);
      
      return { 
        ok: false, 
        error: `No asset found for "${variant}" in release ${version}.\n\nExpected: ${expectedFilename}\n\nAvailable for your platform:\n  ${platformAssets.join('\n  ') || 'None found'}\n\nTry selecting a different variant or download manually from GitHub.`,
        allAssets,
        releaseUrl: releaseData.html_url
      };
    }

    return { 
      ok: true, 
      url: asset.browser_download_url, 
      filename: asset.name, 
      version, 
      sizeMB: Math.round(asset.size / 1e6),
      releaseUrl: releaseData.html_url
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- llama-server installer ---

ipcMain.handle('install-llama-server', async (event, downloadUrl) => {
  const https = require('https');

  const INSTALL_DIR = process.platform === 'win32'
    ? path.join('C:\\', 'llama-server')
    : '/usr/local/bin';
  const tmpZip = path.join(os.tmpdir(), 'llama-cpp-download.zip');

  try {
    // Download with redirect following
    await new Promise((resolve, reject) => {
      function download(url) {
        https.get(url, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            download(res.headers.location);
            return;
          }
          const total = parseInt(res.headers['content-length'], 10) || 0;
          let downloaded = 0;
          const file = fs.createWriteStream(tmpZip);
          res.on('data', chunk => {
            downloaded += chunk.length;
            file.write(chunk);
            if (mainWindow && total > 0) {
              mainWindow.webContents.send('install-progress', {
                stage: 'downloading',
                percent: Math.round((downloaded / total) * 100),
                downloaded: Math.round(downloaded / 1e6),
                total: Math.round(total / 1e6)
              });
            }
          });
          res.on('end', () => { file.end(resolve); });
          res.on('error', reject);
        }).on('error', reject);
      }
      download(downloadUrl);
    });

    // Extract
    if (mainWindow) {
      mainWindow.webContents.send('install-progress', { stage: 'extracting', percent: 50 });
    }

    const AdmZip = require('adm-zip');
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    const zip = new AdmZip(tmpZip);
    const entries = zip.getEntries();

    const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    
    // === PASS 1: Find the binary and its directory ===
    let binaryEntry = null;
    let binaryDir = '';
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const fileName = path.basename(entry.entryName);
      if (fileName.toLowerCase() === binaryName.toLowerCase()) {
        binaryEntry = entry;
        // Extract parent directory path in the archive
        const entryParts = entry.entryName.split('/');
        binaryDir = entryParts.length > 1 ? entryParts.slice(0, -1).join('/') + '/' : '';
        console.log(`[install] Found binary at: ${entry.entryName} (dir: "${binaryDir}")`);
        break;
      }
    }
    
    if (!binaryEntry) {
      // List all files for debugging
      const allFiles = entries
        .filter(e => !e.isDirectory)
        .map(e => e.entryName)
        .join('\n  ');
      return {
        ok: false,
        error: `llama-server binary not found in the downloaded archive.\n\nArchive contents:\n  ${allFiles}\n\nThis may be the wrong variant for your platform. Try a different variant in Step 0.`
      };
    }
    
    // === PASS 2: Extract all files from the same directory as the binary ===
    const ALLOWED_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.metal', '']);
    let extractedCount = 0;
    const extractedFiles = [];
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      
      const entryName = entry.entryName;
      const fileName = path.basename(entryName);
      const ext = path.extname(fileName).toLowerCase();
      
      // Only extract files from the same directory as the binary
      // Or from the root if binary is at root
      const isInBinaryDir = binaryDir === '' 
        ? !entryName.includes('/') 
        : entryName.startsWith(binaryDir);
      
      if (!isInBinaryDir) continue;
      
      // Only extract executables and shared libraries
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;
      
      try {
        zip.extractEntryTo(entry, INSTALL_DIR, false, true);
        extractedCount++;
        extractedFiles.push(fileName);
        
        if (mainWindow) {
          mainWindow.webContents.send('install-progress', {
            stage: 'extracting',
            percent: Math.round(50 + (extractedCount / entries.length) * 40),
            currentFile: fileName
          });
        }
      } catch (e) {
        console.warn(`[install] Failed to extract ${fileName}:`, e.message);
      }
    }
    
    console.log(`[install] Extracted ${extractedCount} files to ${INSTALL_DIR}:`, extractedFiles.join(', '));

    // Make executable on macOS/Linux
    if (process.platform !== 'win32') {
      const binaryPath = path.join(INSTALL_DIR, 'llama-server');
      if (fs.existsSync(binaryPath)) {
        fs.chmodSync(binaryPath, 0o755);
      }
    }

    const destPath = path.join(INSTALL_DIR, binaryName);
    
    // Verify the binary was actually extracted
    if (!fs.existsSync(destPath)) {
      return {
        ok: false,
        error: `Installation failed: llama-server was found in archive but not extracted to ${destPath}. Extracted files: ${extractedFiles.join(', ')}`
      };
    }

    // PATH update on Windows
    if (process.platform === 'win32') {
      if (mainWindow) {
        mainWindow.webContents.send('install-progress', { stage: 'configuring', percent: 90 });
      }
      // Read current system PATH from registry and append INSTALL_DIR
      const psCmd = [
        '$currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine");',
        `if ($currentPath -notlike "*${INSTALL_DIR}*") {`,
        `  [Environment]::SetEnvironmentVariable("PATH", "$currentPath;${INSTALL_DIR}", "Machine");`,
        '  Write-Output "PATH updated"',
        '} else {',
        '  Write-Output "Already in PATH"',
        '}'
      ].join(' ');

      try {
        const result = execSync(
          `powershell -NoProfile -Command "${psCmd}"`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        console.log('[install] PATH update:', result.trim());
      } catch (e) {
        // Fallback: user-level PATH (does not require admin)
        const psCmdUser = [
          '$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User");',
          `if ($currentPath -notlike "*${INSTALL_DIR}*") {`,
          `  [Environment]::SetEnvironmentVariable("PATH", "$currentPath;${INSTALL_DIR}", "User");`,
          '  Write-Output "User PATH updated"',
          '} else {',
          '  Write-Output "Already in user PATH"',
          '}'
        ].join(' ');
        try {
          execSync(
            `powershell -NoProfile -Command "${psCmdUser}"`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          console.log('[install] Fallback to user PATH update');
        } catch (e2) {
          console.warn('[install] PATH update failed:', e2.message);
        }
      }

      // Make llama-server available in current process immediately
      if (!process.env.PATH.includes(INSTALL_DIR)) {
        process.env.PATH = process.env.PATH + path.delimiter + INSTALL_DIR;
        console.log('[install] Added to current process PATH:', INSTALL_DIR);
      }
    }

    if (mainWindow) {
      mainWindow.webContents.send('install-progress', { stage: 'complete', percent: 100, installDir: INSTALL_DIR });
    }

    return { ok: true, installDir: INSTALL_DIR, binaryPath: destPath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tmpZip); } catch (e) {}
  }
});

// --- Utility handlers ---

ipcMain.handle('restart-app', async () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('open-external-url', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});


// --- Installation completeness check ---

ipcMain.handle('check-llama-installation', async () => {
  const INSTALL_DIR = process.platform === 'win32'
    ? path.join('C:\\', 'llama-server')
    : '/usr/local/bin';

  const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const binaryPath = path.join(INSTALL_DIR, binaryName);

  const result = {
    binaryExists: false,
    binaryPath: null,
    missingDlls: [],
    installDir: INSTALL_DIR,
    filesPresent: []
  };

  if (!fs.existsSync(binaryPath)) {
    return result;
  }

  result.binaryExists = true;
  result.binaryPath = binaryPath;

  // On Windows, check for required DLLs
  if (process.platform === 'win32') {
    const REQUIRED_DLLS = ['ggml-base.dll', 'ggml.dll', 'llama.dll'];
    const filesInDir = fs.existsSync(INSTALL_DIR) ? fs.readdirSync(INSTALL_DIR) : [];
    result.filesPresent = filesInDir;
    for (const dll of REQUIRED_DLLS) {
      if (!filesInDir.includes(dll)) {
        result.missingDlls.push(dll);
      }
    }
  }

  return result;
});

// --- Server logs management ---

ipcMain.handle('get-server-logs', async (event, modelId) => {
  return serverLogs.get(modelId) || [];
});

ipcMain.handle('clear-server-logs', async (event, modelId) => {
  serverLogs.set(modelId, []);
  return { ok: true };
});

// --- Force start model (bypasses health checks, kills existing process) ---

ipcMain.handle('force-start-model', async (event, id) => {
  const model = appModels.find(m => m.id === id);
  if (!model) return { ok: false, error: 'Model not found' };

  // Initialize or clear logs
  serverLogs.set(id, []);
  const addLog = (type, message) => {
    const logs = serverLogs.get(id) || [];
    const timestamp = new Date().toISOString().substr(11, 8);
    const entry = { timestamp, type, message };
    logs.push(entry);
    if (logs.length > MAX_LOG_LINES) logs.shift();
    serverLogs.set(id, logs);
    if (mainWindow) {
      mainWindow.webContents.send('server-log', { modelId: id, entry });
    }
  };

  addLog('info', '=== FORCE START initiated ===');

  // Force kill any existing process
  if (inferenceProcesses.has(id)) {
    addLog('info', 'Killing existing process...');
    try { 
      const proc = inferenceProcesses.get(id);
      proc.kill('SIGKILL'); // Force kill instead of SIGTERM
    } catch (e) {
      addLog('warn', `Kill failed: ${e.message}`);
    }
    inferenceProcesses.delete(id);
    // Wait a bit for port to be released
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Also try to kill any process on the port (Unix only)
  if (process.platform !== 'win32') {
    try {
      addLog('info', `Checking for processes on port ${model.port}...`);
      const lsofResult = execSync(`lsof -ti:${model.port} 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
      if (lsofResult) {
        addLog('info', `Found PID(s) on port: ${lsofResult}`);
        execSync(`kill -9 ${lsofResult.split('\n').join(' ')} 2>/dev/null || true`);
        addLog('info', 'Killed existing processes on port');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (e) {
      addLog('warn', `Port cleanup failed: ${e.message}`);
    }
  }

  if (!model.modelPath || typeof model.modelPath !== 'string' || model.modelPath.trim() === '') {
    addLog('error', 'Model path is not set');
    return { ok: false, error: 'Model path is not set. Edit the model configuration first.' };
  }
  if (!fs.existsSync(model.modelPath)) {
    addLog('error', `Model file not found: ${model.modelPath}`);
    return { ok: false, error: `Model file not found: ${model.modelPath}` };
  }

  // Resolve llama-server binary
  let llamaBinary = 'llama-server';
  try {
    const cmd = process.platform === 'win32' ? 'where llama-server' : 'which llama-server';
    execSync(cmd, { encoding: 'utf-8' });
  } catch (e) {
    const INSTALL_DIR = process.platform === 'win32'
      ? path.join('C:\\', 'llama-server')
      : '/usr/local/bin';
    const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const knownPath = path.join(INSTALL_DIR, binaryName);

    if (fs.existsSync(knownPath)) {
      llamaBinary = knownPath;
    } else {
      addLog('error', 'llama-server not found');
      return { ok: false, error: 'llama-server not found. Complete the host setup in Step 0.' };
    }
  }

  const args = [
    '-m', model.modelPath,
    '--port', String(model.port),
    '-ngl', String(model.nGpuLayers || 99),
  ];

  const enabledWorkers = appWorkers.filter(w => w.enabled);
  if (enabledWorkers.length > 0) {
    args.push('--rpc', enabledWorkers.map(w => `${w.ip}:${w.port}`).join(','));
  }

  addLog('info', `Command: ${llamaBinary} ${args.join(' ')}`);

  let proc;
  try {
    proc = spawn(llamaBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  } catch (err) {
    addLog('error', `Spawn failed: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // Capture output
  if (proc.stdout) {
    proc.stdout.on('data', (data) => {
      data.toString().split('\n').filter(l => l.trim()).forEach(line => addLog('stdout', line));
    });
  }
  if (proc.stderr) {
    proc.stderr.on('data', (data) => {
      data.toString().split('\n').filter(l => l.trim()).forEach(line => addLog('stderr', line));
    });
  }

  proc.on('error', (err) => addLog('error', `Process error: ${err.message}`));
  proc.on('exit', (code, signal) => {
    inferenceProcesses.delete(id);
    const m = appModels.find(x => x.id === id);
    if (m) m.status = 'stopped';
    addLog('info', `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
  });

  inferenceProcesses.set(id, proc);

  // Wait for port with extended timeout for force start
  addLog('info', `Waiting for port ${model.port} (timeout: 60s)...`);
  try {
    await waitForPort(model.port, 60000); // Extended timeout for force start
  } catch (err) {
    addLog('error', `Port wait failed: ${err.message}`);
    // Don't kill the process - let it keep trying
    addLog('warn', 'Server may still be starting. Check logs for progress.');
    model.status = 'starting';
    return {
      ok: false,
      error: `Server did not respond within 60 seconds. Check logs for details. The process is still running.`,
      stillRunning: true
    };
  }

  addLog('info', `Server is now listening on port ${model.port}`);
  model.status = 'running';
  return {
    ok: true,
    url: `http://localhost:${model.port}/v1`,
    model: model.name,
    port: model.port
  };
});
