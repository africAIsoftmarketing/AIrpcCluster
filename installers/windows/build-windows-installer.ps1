# RPC Cluster Worker - Windows Installer Build Script
# Requires: Inno Setup 6 (install via Chocolatey: choco install innosetup)

param(
    [switch]$SkipVendorCheck,
    [switch]$Sign
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Status { param($Message) Write-Host "[*] $Message" -ForegroundColor Cyan }
function Write-Success { param($Message) Write-Host "[+] $Message" -ForegroundColor Green }
function Write-Warning { param($Message) Write-Host "[!] $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "[-] $Message" -ForegroundColor Red }

Write-Status "=== RPC Cluster Worker - Windows Installer Build ==="

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Get-Item "$ScriptDir\..\..").FullName

# Check for Inno Setup
Write-Status "Checking for Inno Setup..."

$IsccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe"
)

$IsccPath = $null
foreach ($path in $IsccPaths) {
    if (Test-Path $path) {
        $IsccPath = $path
        break
    }
}

# Try PATH
if (-not $IsccPath) {
    $IsccPath = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if (-not $IsccPath) {
    Write-Error "Inno Setup 6 not found!"
    Write-Host ""
    Write-Host "Please install Inno Setup 6:"
    Write-Host "  Option 1: choco install innosetup"
    Write-Host "  Option 2: Download from https://jrsoftware.org/isdl.php"
    Write-Host ""
    exit 1
}

Write-Success "Found Inno Setup: $IsccPath"

# Check for vendor binaries
if (-not $SkipVendorCheck) {
    Write-Status "Checking for vendor binaries..."
    
    $VendorDir = "$RootDir\vendor\windows"
    $RpcServerPath = "$VendorDir\rpc-server.exe"
    
    if (-not (Test-Path $RpcServerPath)) {
        Write-Error "rpc-server.exe not found at: $RpcServerPath"
        Write-Host ""
        Write-Host "Please download rpc-server.exe from llama.cpp releases:"
        Write-Host "  1. Visit: https://github.com/ggerganov/llama.cpp/releases"
        Write-Host "  2. Download: llama-<version>-bin-win-noavx-x64.zip (CPU)"
        Write-Host "     or: llama-<version>-bin-win-cuda-cu12.4-x64.zip (CUDA)"
        Write-Host "  3. Extract rpc-server.exe to: $VendorDir"
        Write-Host ""
        exit 1
    }
    
    Write-Success "Found rpc-server.exe"
}

# Check for beacon executable
$BeaconPath = "$RootDir\worker-beacon\dist\rpc-worker-beacon-win.exe"
if (-not (Test-Path $BeaconPath)) {
    Write-Error "Worker beacon executable not found at: $BeaconPath"
    Write-Host ""
    Write-Host "Please build the beacon first. Run on a Windows machine or via GitHub Actions:"
    Write-Host "  cd worker-beacon"
    Write-Host "  node --experimental-sea-config sea-config.json"
    Write-Host "  copy node.exe dist\rpc-worker-beacon-win.exe"
    Write-Host "  npx postject dist\rpc-worker-beacon-win.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
    Write-Host ""
    exit 1
}

Write-Success "Found beacon executable"

# Create dist directory
$DistDir = "$RootDir\dist"
if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

# Build the installer
Write-Status "Building installer..."

$SetupIss = "$ScriptDir\setup.iss"

try {
    & "$IsccPath" "$SetupIss"
    
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup compilation failed with exit code: $LASTEXITCODE"
    }
}
catch {
    Write-Error "Failed to build installer: $_"
    exit 1
}

# Check output
$OutputPath = "$DistDir\rpc-cluster-worker-setup-win64.exe"
if (-not (Test-Path $OutputPath)) {
    Write-Error "Expected output not found: $OutputPath"
    exit 1
}

Write-Success "Installer built successfully!"

# Optional: Sign the installer
if ($Sign) {
    Write-Status "Signing installer..."
    
    if (-not $env:WIN_SIGNING_CERT) {
        Write-Warning "WIN_SIGNING_CERT environment variable not set. Skipping signing."
        Write-Host "To sign the installer, set WIN_SIGNING_CERT to the path of your .pfx certificate"
        Write-Host "and WIN_SIGNING_CERT_PASSWORD to the certificate password."
    }
    else {
        try {
            $SignToolArgs = @(
                "sign",
                "/f", $env:WIN_SIGNING_CERT,
                "/p", $env:WIN_SIGNING_CERT_PASSWORD,
                "/t", "http://timestamp.digicert.com",
                "/v",
                $OutputPath
            )
            
            & signtool $SignToolArgs
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Installer signed successfully!"
            }
            else {
                Write-Warning "Signing failed with exit code: $LASTEXITCODE"
            }
        }
        catch {
            Write-Warning "Failed to sign installer: $_"
        }
    }
}
else {
    Write-Warning "Installer is unsigned. Use -Sign flag to sign with a certificate."
}

# Print output info
Write-Host ""
Write-Success "=== Build Complete ==="
Write-Host "Output: $OutputPath"
Write-Host "Size: $([math]::Round((Get-Item $OutputPath).Length / 1MB, 2)) MB"
