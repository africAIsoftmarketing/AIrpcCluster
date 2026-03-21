package com.rpccluster.worker

class RpcServerManager {
    companion object {
        init {
            System.loadLibrary("rpc_server_jni")
        }
    }

    external fun startServer(port: Int): Int
    external fun stopServer()
    external fun isServerRunning(): Boolean
}
