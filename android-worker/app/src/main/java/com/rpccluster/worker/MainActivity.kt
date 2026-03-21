package com.rpccluster.worker

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Timer
import java.util.TimerTask

// Theme colors matching the Configurator
private val Bg = Color(0xFF1A1A1A)
private val CardBg = Color(0xFF242424)
private val Accent = Color(0xFF7C6DF0)
private val TextPrimary = Color(0xFFE8E8E8)
private val TextSecondary = Color(0xFF888888)
private val GreenActive = Color(0xFF4CAF50)
private val RedStop = Color(0xFFC62828)

private val AppColorScheme: ColorScheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    background = Bg,
    surface = CardBg,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    secondary = TextSecondary,
    error = RedStop,
)

class MainActivity : ComponentActivity() {
    private val rpcServer = RpcServerManager()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Check auto-start preference
        val prefs = getSharedPreferences("rpc_cluster", Context.MODE_PRIVATE)
        val autoStart = prefs.getBoolean("auto_start", false)
        if (autoStart && !rpcServer.isServerRunning()) {
            WorkerService.start(this)
        }

        setContent {
            MaterialTheme(colorScheme = AppColorScheme) {
                WorkerScreen(rpcServer)
            }
        }
    }
}

@Composable
fun WorkerScreen(rpcServer: RpcServerManager) {
    val context = LocalContext.current
    val prefs = context.getSharedPreferences("rpc_cluster", Context.MODE_PRIVATE)

    var isRunning by remember { mutableStateOf(rpcServer.isServerRunning()) }
    var autoStart by remember { mutableStateOf(prefs.getBoolean("auto_start", false)) }
    var instructionsExpanded by remember { mutableStateOf(false) }

    // Poll server status every 2 seconds
    DisposableEffect(Unit) {
        val timer = Timer()
        timer.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                isRunning = rpcServer.isServerRunning()
            }
        }, 0L, 2000L)
        onDispose { timer.cancel() }
    }

    val hostname = remember { HardwareInfo.getHostname(context) }
    val ip = remember { HardwareInfo.getWifiIpAddress(context) }
    val ramGB = remember { HardwareInfo.getTotalRamGB(context) }
    val cpuCores = remember { HardwareInfo.getCpuCores() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Bg)
            .verticalScroll(rememberScrollState())
            .padding(20.dp)
    ) {
        // Title
        Text(
            text = "RPC Cluster Worker",
            fontSize = 22.sp,
            fontWeight = FontWeight.Medium,
            color = TextPrimary
        )
        Text(
            text = "Android worker node for distributed inference",
            fontSize = 13.sp,
            color = TextSecondary
        )

        Spacer(Modifier.height(20.dp))

        // Status card
        StatusCard(isRunning, ip)

        Spacer(Modifier.height(12.dp))

        // Info card
        InfoCard(hostname, ip, ramGB, cpuCores)

        Spacer(Modifier.height(16.dp))

        // Start/Stop button
        val btnColor by animateColorAsState(
            if (isRunning) RedStop else GreenActive, label = "btnColor"
        )
        Button(
            onClick = {
                if (isRunning) {
                    WorkerService.stop(context)
                } else {
                    WorkerService.start(context)
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.buttonColors(containerColor = btnColor)
        ) {
            Text(
                text = if (isRunning) "Stop Worker" else "Start Worker",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = Color.White
            )
        }

        Spacer(Modifier.height(16.dp))

        // Auto-start toggle
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(CardBg)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Start worker on app launch",
                fontSize = 14.sp,
                color = TextPrimary
            )
            Switch(
                checked = autoStart,
                onCheckedChange = { checked ->
                    autoStart = checked
                    prefs.edit().putBoolean("auto_start", checked).apply()
                },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color.White,
                    checkedTrackColor = Accent,
                    uncheckedThumbColor = TextSecondary,
                    uncheckedTrackColor = CardBg
                )
            )
        }

        Spacer(Modifier.height(16.dp))

        // Instructions card (collapsible)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(CardBg)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { instructionsExpanded = !instructionsExpanded }
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("How to use", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Text(if (instructionsExpanded) "▼" else "▶", color = TextSecondary, fontSize = 14.sp)
            }
            if (instructionsExpanded) {
                Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    val steps = listOf(
                        "Ensure this device and the host laptop are on the same Wi-Fi network.",
                        "Tap Start Worker — this device will appear in the RPC Cluster Configurator on the host laptop.",
                        "On the host: open the Configurator, click Scan LAN, and this device will appear in the workers list.",
                        "Select your model, save configuration, and start the inference server."
                    )
                    steps.forEachIndexed { i, step ->
                        Text(
                            text = "${i + 1}. $step",
                            fontSize = 13.sp,
                            color = TextSecondary,
                            lineHeight = 20.sp,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
fun StatusCard(isRunning: Boolean, ip: String) {
    val dotColor by animateColorAsState(
        if (isRunning) GreenActive else TextSecondary, label = "dotColor"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(CardBg)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(dotColor)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = if (isRunning) "Worker Active" else "Worker Stopped",
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
            color = TextPrimary
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = if (isRunning) "$ip:50052" else "Start the worker to join the cluster",
            fontSize = 13.sp,
            color = TextSecondary
        )
    }
}

@Composable
fun InfoCard(hostname: String, ip: String, ramGB: Float, cpuCores: Int) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(CardBg)
            .padding(16.dp)
    ) {
        InfoRow("Device", hostname)
        InfoRow("IP Address", ip)
        InfoRow("RPC Port", "50052")
        InfoRow("RAM", "$ramGB GB")
        InfoRow("CPU Cores", cpuCores.toString())
        InfoRow("Platform", "Android")
    }
}

@Composable
fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
    ) {
        Text(
            text = label,
            fontSize = 13.sp,
            color = TextSecondary,
            modifier = Modifier.width(100.dp)
        )
        Text(
            text = value,
            fontSize = 13.sp,
            color = TextPrimary
        )
    }
}
