package com.rpccluster.worker

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

class BeaconBroadcaster(private val context: Context) {

    private val PORT = 5005
    private val INTERVAL_MS = 3000L
    private var job: Job? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    /**
     * Starts broadcasting UDP discovery beacons every 3 seconds.
     * Acquires a MulticastLock to allow UDP broadcast on Android.
     * Payload is JSON matching the existing worker-beacon format:
     * {"hostname":"...","ip":"...","port":50052,"vramGB":0,"platform":"android"}
     */
    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return

        // Acquire MulticastLock for UDP broadcast
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicastLock = wifiManager.createMulticastLock("rpc_cluster_beacon").apply {
            setReferenceCounted(false)
            acquire()
        }

        job = scope.launch(Dispatchers.IO) {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket().apply {
                    broadcast = true
                    reuseAddress = true
                }

                val broadcastAddr = InetAddress.getByName("255.255.255.255")

                while (isActive) {
                    try {
                        val hostname = HardwareInfo.getHostname(context)
                        val ip = HardwareInfo.getWifiIpAddress(context)

                        val payload = """{"hostname":"$hostname","ip":"$ip","port":50052,"vramGB":0,"platform":"android"}"""
                        val data = payload.toByteArray(Charsets.UTF_8)
                        val packet = DatagramPacket(data, data.size, broadcastAddr, PORT)
                        socket.send(packet)
                    } catch (e: Exception) {
                        // Ignore individual send failures — retry on next interval
                    }
                    delay(INTERVAL_MS)
                }
            } catch (e: Exception) {
                // Socket creation failed — beacon cannot operate
            } finally {
                socket?.close()
            }
        }
    }

    /**
     * Stops broadcasting and releases the MulticastLock.
     */
    fun stop() {
        job?.cancel()
        job = null

        try {
            if (multicastLock?.isHeld == true) {
                multicastLock?.release()
            }
        } catch (e: Exception) {
            // Ignore release errors
        }
        multicastLock = null
    }
}
