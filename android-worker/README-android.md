# RPC Cluster Worker — Android App

Android application that runs llama.cpp's `rpc-server` and the UDP
discovery beacon on an Android device, making it available as a worker
node in the RPC Cluster distributed inference system.

The Android device joins the cluster exactly like a laptop worker:
- Runs `rpc-server` on TCP port 50052
- Broadcasts UDP beacons on port 5005
- The host Configurator discovers it automatically via LAN scan
- `llama-server` on the host distributes model layers to it

---

## Prerequisites

- **Android Studio** Hedgehog (2023.1) or later
- **Android NDK 26+** — install via SDK Manager → SDK Tools → NDK
- **CMake 3.22+** — install via SDK Manager → SDK Tools → CMake
- A physical Android device (API 26+ / Android 8.0 Oreo) or emulator
  - Note: `rpc-server` performance on emulator is minimal — use a
    physical device for real inference workloads

## Build instructions

1. Open the `android-worker/` directory in Android Studio
2. Sync Gradle (File → Sync Project with Gradle Files)
3. The first build downloads llama.cpp source (~500MB) and compiles
   `rpc-server` for ARM64 — allow **10-15 minutes**
4. Connect a physical device via USB with USB debugging enabled
5. Click Run (or `./gradlew installDebug` from terminal)

```bash
cd android-worker
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

## How to use

1. Ensure the Android device and host laptop are on the **same Wi-Fi
   network**
2. Open the app and tap **Start Worker**
3. On the host laptop, open the **RPC Cluster Configurator**
4. Click **Scan LAN** — the Android device appears in the workers list
5. Select a model, save configuration, and start the inference server
6. The host's `llama-server` distributes model layers to the Android
   device automatically

## Network requirements

| Port | Protocol | Direction | Purpose |
|------|----------|-----------|---------|
| 5005 | UDP | Device → Broadcast | Discovery beacon |
| 50052 | TCP | Host → Device | RPC inference data |

- Device and host **must be on the same subnet**
- UDP port 5005 must not be blocked by the router
- TCP port 50052 must be reachable from the host
- Some corporate/university Wi-Fi networks block device-to-device
  traffic — use a **personal hotspot** if the device is not detected

## Performance expectations

- Android devices contribute **CPU and RAM** to the cluster
- A device with 8GB RAM can hold approximately 4-6GB of model layers
- Inference speed depends on the device's CPU:
  - Flagship (Snapdragon 8 Gen 2+, Dimensity 9200+): ~2-5 tok/s per layer
  - Mid-range: ~1-2 tok/s per layer
- Battery usage: the Foreground Service keeps the CPU active via
  WakeLock — expect significant battery drain during active inference
- Recommended: keep the device plugged in while serving as a worker

## Architecture

```
android-worker/
├── app/
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── cpp/
│   │   │   ├── CMakeLists.txt          # NDK build, fetches llama.cpp
│   │   │   └── rpc_server_wrapper.cpp  # JNI bridge to native server
│   │   ├── java/com/rpccluster/worker/
│   │   │   ├── MainActivity.kt         # Jetpack Compose UI
│   │   │   ├── WorkerService.kt        # Foreground Service
│   │   │   ├── BeaconBroadcaster.kt    # UDP discovery beacon
│   │   │   ├── HardwareInfo.kt         # Device info (RAM, IP, etc.)
│   │   │   ├── RpcServerManager.kt     # JNI interface
│   │   │   └── WorkerApplication.kt    # Application class
│   │   └── res/
│   │       ├── values/strings.xml
│   │       ├── values/colors.xml
│   │       └── drawable/ic_notification.xml
│   └── build.gradle
├── build.gradle          # Project-level Gradle config
├── settings.gradle
├── gradle.properties
└── README-android.md     # This file
```

## Troubleshooting

**"Device not detected in Configurator"**
- Verify both devices are on the same Wi-Fi subnet
- Check that UDP port 5005 is not blocked
- Try a personal hotspot instead of corporate/university Wi-Fi
- Open the app and confirm the status shows "Worker Active" with
  a valid IP address (not 0.0.0.0)

**"rpc-server crashes on start"**
- Check logcat for NDK errors: `adb logcat -s RpcServerJNI`
- Ensure the device has at least 2GB free RAM
- Another app may be using port 50052 — try rebooting the device

**"Build fails at NDK step"**
- Verify NDK version >= 26 in `local.properties`:
  `ndk.dir=/path/to/android-sdk/ndk/26.x.x`
- Ensure CMake 3.22+ is installed via SDK Manager
- If FetchContent fails, check internet connectivity — the first
  build downloads llama.cpp source code

**"App killed in background"**
- The Foreground Service with persistent notification should prevent
  this on most devices
- On MIUI/ColorOS/OneUI: disable battery optimization for the app
  in Settings → Apps → RPC Cluster Worker → Battery → Unrestricted

**"High battery drain"**
- Expected during active inference — the CPU is computing tensor ops
- Keep the device plugged in while serving as a worker node
- The WakeLock prevents the CPU from sleeping, which is required
  for the RPC server to respond to requests
