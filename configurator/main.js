const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
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
    // Sanitize model path — strip surrounding quotes
    if (config.modelPath) {
      config.modelPath = config.modelPath.trim().replace(/^["']|["']$/g, '');
    }

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

    // Resolve llama-server binary path
    let llamaBinary = 'llama-server';
    try {
      const cmd = process.platform === 'win32' ? 'where llama-server' : 'which llama-server';
      execSync(cmd, { encoding: 'utf-8' });
    } catch (e) {
      const knownPath = process.platform === 'win32'
        ? 'C:\\llama-server\\llama-server.exe'
        : '/usr/local/bin/llama-server';
      if (fs.existsSync(knownPath)) {
        llamaBinary = knownPath;
      } else {
        return {
          ok: false,
          error: 'llama-server not found. Complete the host setup step to install it.'
        };
      }
    }

    try {
      inferenceServerProcess = spawn(llamaBinary, args, {
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
      ? 'C:\\llama-server\\llama-server.exe'
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

ipcMain.handle('get-llama-download-url', async (event, variant) => {
  const https = require('https');

  const WIN_PATTERNS = {
    'cpu':         'llama-{version}-bin-win-cpu-x64.zip',
    'cuda-cu11.7': 'llama-{version}-bin-win-cuda-cu11.7-x64.zip',
    'cuda-cu12.4': 'llama-{version}-bin-win-cuda-cu12.4-x64.zip',
    'vulkan':      'llama-{version}-bin-win-vulkan-x64.zip',
  };
  const MAC_PATTERNS = {
    'metal': 'llama-{version}-bin-macos-arm64.zip',
    'cpu':   'llama-{version}-bin-macos-x64.zip',
  };
  const LINUX_PATTERNS = {
    'cpu':         'llama-{version}-bin-linux-x64.zip',
    'cuda-cu12.4': 'llama-{version}-bin-linux-cuda-cu12.4-x64.zip',
    'vulkan':      'llama-{version}-bin-linux-vulkan-x64.zip',
  };

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
    const patterns = process.platform === 'win32' ? WIN_PATTERNS
      : process.platform === 'darwin' ? MAC_PATTERNS : LINUX_PATTERNS;
    const pattern = patterns[variant] ?? patterns['cpu'];
    const filename = pattern.replace('{version}', version);

    const asset = releaseData.assets.find(a =>
      a.name === filename ||
      a.name.toLowerCase().includes(filename.replace(`llama-${version}-bin-`, '').replace('.zip', '').toLowerCase())
    );

    if (!asset) {
      return { ok: false, error: `No asset found for "${variant}" in release ${version}`, allAssets: releaseData.assets.map(a => a.name) };
    }

    return { ok: true, url: asset.browser_download_url, filename: asset.name, version, sizeMB: Math.round(asset.size / 1e6) };
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
    const entry = entries.find(e => e.entryName.endsWith(binaryName) && !e.isDirectory);

    if (!entry) {
      return { ok: false, error: 'llama-server binary not found in downloaded archive.' };
    }

    zip.extractEntryTo(entry, INSTALL_DIR, false, true);
    const destPath = path.join(INSTALL_DIR, binaryName);

    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, 0o755);
    }

    // PATH update on Windows
    if (process.platform === 'win32') {
      if (mainWindow) {
        mainWindow.webContents.send('install-progress', { stage: 'configuring', percent: 90 });
      }
      try {
        execSync(`setx PATH "%PATH%;${INSTALL_DIR}" /M`, { encoding: 'utf-8' });
      } catch (e) {
        try { execSync(`setx PATH "%PATH%;${INSTALL_DIR}"`, { encoding: 'utf-8' }); } catch (e2) {}
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
