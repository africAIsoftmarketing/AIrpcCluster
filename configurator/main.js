const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');
const { discoverWorkers, CONFIG_PATH } = require('./shared/discovery');

let mainWindow = null;
let inferenceServerProcess = null;

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
  if (inferenceServerProcess) {
    try {
      inferenceServerProcess.kill('SIGTERM');
    } catch (e) {
      // Ignore kill errors
    }
    inferenceServerProcess = null;
  }
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
    const configDir = path.dirname(CONFIG_PATH);
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-config', async () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null;
    }
    
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return null;
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

ipcMain.handle('start-inference-server', async () => {
  try {
    // Kill existing process if any
    if (inferenceServerProcess) {
      try {
        inferenceServerProcess.kill('SIGTERM');
      } catch (e) {
        // Ignore
      }
      inferenceServerProcess = null;
    }

    const config = loadConfig();
    if (!config || !config.modelPath || typeof config.modelPath !== 'string' || config.modelPath.trim() === '') {
      return {
        ok: false,
        error: 'Model path is not set or file does not exist. Configure a model in the Configurator first.'
      };
    }

    if (!fs.existsSync(config.modelPath)) {
      return {
        ok: false,
        error: 'Model path is not set or file does not exist. Configure a model in the Configurator first.'
      };
    }

    const args = [
      '-m', config.modelPath,
      '--port', '18080',
      '-ngl', String(config.nGpuLayers || 99),
      '--log-disable',
    ];

    const enabledWorkers = (config.workers || []).filter(w => w.enabled);
    if (enabledWorkers.length > 0) {
      args.push('--rpc', enabledWorkers.map(w => `${w.ip}:${w.port}`).join(','));
    }

    try {
      inferenceServerProcess = spawn('llama-server', args, {
        stdio: 'ignore',
        detached: false
      });
    } catch (err) {
      inferenceServerProcess = null;
      if (err.code === 'ENOENT') {
        return {
          ok: false,
          error: 'llama-server not found in PATH. Install llama.cpp from https://github.com/ggml-org/llama.cpp/releases and ensure llama-server is accessible from your terminal.'
        };
      }
      throw err;
    }

    // Handle spawn errors (ENOENT fires asynchronously on some platforms)
    let spawnError = null;
    inferenceServerProcess.on('error', (err) => {
      spawnError = err;
    });

    inferenceServerProcess.on('exit', () => {
      inferenceServerProcess = null;
    });

    // Wait for port 18080 to become ready
    try {
      await waitForPort(18080, 30000);
    } catch (err) {
      // Cleanup on timeout
      try {
        if (inferenceServerProcess) {
          inferenceServerProcess.kill('SIGTERM');
        }
      } catch (e) {
        // Ignore
      }
      inferenceServerProcess = null;

      if (spawnError && spawnError.code === 'ENOENT') {
        return {
          ok: false,
          error: 'llama-server not found in PATH. Install llama.cpp from https://github.com/ggml-org/llama.cpp/releases and ensure llama-server is accessible from your terminal.'
        };
      }
      return {
        ok: false,
        error: 'llama-server did not start within 30 seconds. Check that llama-server is in PATH and the model path is valid.'
      };
    }

    return {
      ok: true,
      url: 'http://localhost:18080/v1',
      workers: enabledWorkers.length,
      model: path.basename(config.modelPath)
    };
  } catch (err) {
    // Cleanup on any unexpected error
    if (inferenceServerProcess) {
      try {
        inferenceServerProcess.kill('SIGTERM');
      } catch (e) {
        // Ignore
      }
      inferenceServerProcess = null;
    }
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stop-inference-server', async () => {
  try {
    if (inferenceServerProcess) {
      try {
        inferenceServerProcess.kill('SIGTERM');
      } catch (e) {
        // Ignore kill errors
      }
      inferenceServerProcess = null;
    }
    return { ok: true };
  } catch (err) {
    return { ok: true };
  }
});

ipcMain.handle('get-inference-server-status', async () => {
  try {
    const running = inferenceServerProcess !== null && !inferenceServerProcess.killed;
    return {
      running,
      url: running ? 'http://localhost:18080/v1' : null
    };
  } catch (err) {
    return { running: false, url: null };
  }
});
