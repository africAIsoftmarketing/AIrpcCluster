package com.rpccluster.worker

import android.app.ActivityManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings

object HardwareInfo {

    /**
     * Returns total device RAM in GB (rounded to 1 decimal).
     * Android has no dedicated GPU VRAM — report 0 for vramGB
     * and use total RAM as a proxy for available memory.
     */
    fun getTotalRamGB(context: Context): Float {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memInfo)
        val totalGB = memInfo.totalMem.toFloat() / (1024f * 1024f * 1024f)
        return Math.round(totalGB * 10f) / 10f
    }

    /**
     * Returns the device hostname.
     * Prefers Settings.Global.DEVICE_NAME, falls back to Build.MODEL.
     */
    fun getHostname(context: Context): String {
        val deviceName = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
        if (!deviceName.isNullOrBlank()) {
            return deviceName.trim()
        }
        return Build.MODEL.trim()
    }

    /**
     * Returns the current Wi-Fi IP address as a dotted-decimal string.
     * Returns "0.0.0.0" if Wi-Fi is not connected.
     */
    @Suppress("DEPRECATION")
    fun getWifiIpAddress(context: Context): String {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val ipInt = wifiManager.connectionInfo.ipAddress
        if (ipInt == 0) return "0.0.0.0"
        return "${ipInt and 0xFF}.${ipInt shr 8 and 0xFF}.${ipInt shr 16 and 0xFF}.${ipInt shr 24 and 0xFF}"
    }

    /**
     * Returns the number of available CPU cores.
     */
    fun getCpuCores(): Int {
        return Runtime.getRuntime().availableProcessors()
    }
}
