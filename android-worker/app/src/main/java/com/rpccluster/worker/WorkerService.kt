package com.rpccluster.worker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class WorkerService : Service() {

    private val rpcServer = RpcServerManager()
    private lateinit var beacon: BeaconBroadcaster
    private var wakeLock: PowerManager.WakeLock? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var isRunning = false

    companion object {
        const val RPC_PORT = 50052
        const val NOTIFICATION_ID = 1
        const val CHANNEL_ID = "rpc_cluster_worker"
        const val ACTION_START = "START"
        const val ACTION_STOP = "STOP"

        fun start(context: Context) {
            val intent = Intent(context, WorkerService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, WorkerService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        beacon = BeaconBroadcaster(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startWorker()
            ACTION_STOP -> stopWorker()
        }
        return START_STICKY
    }

    private fun startWorker() {
        if (isRunning) return
        isRunning = true

        // 1. Create notification channel
        val channel = NotificationChannel(
            CHANNEL_ID,
            "RPC Cluster Worker",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when the RPC worker is running"
            setShowBadge(false)
        }
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)

        // 2. Build persistent notification
        val notification = buildNotification("Starting...")
        startForeground(NOTIFICATION_ID, notification)

        // 3. Acquire WakeLock
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "rpc-cluster::WorkerWakeLock"
        ).apply {
            acquire(24 * 60 * 60 * 1000L) // 24 hours max
        }

        // 4. Start rpc-server
        val result = rpcServer.startServer(RPC_PORT)
        if (result != 0) {
            updateNotification("Failed to start — port $RPC_PORT may be in use")
            stopWorker()
            return
        }

        // 5. Start beacon
        beacon.start(scope)

        // 6. Update notification with actual IP
        val ip = HardwareInfo.getWifiIpAddress(this)
        updateNotification("Running — $ip:$RPC_PORT")
    }

    private fun stopWorker() {
        if (!isRunning) {
            stopSelf()
            return
        }
        isRunning = false

        // Stop rpc-server
        try {
            rpcServer.stopServer()
        } catch (e: Exception) {
            // Ignore
        }

        // Stop beacon
        try {
            beacon.stop()
        } catch (e: Exception) {
            // Ignore
        }

        // Release WakeLock
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) {
            // Ignore
        }
        wakeLock = null

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(statusText: String): Notification {
        // Open app intent
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Stop action intent
        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, WorkerService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RPC Cluster Worker")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .addAction(0, "Stop", stopIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification(statusText: String) {
        val notification = buildNotification(statusText)
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopWorker()
        scope.cancel()
        super.onDestroy()
    }
}
