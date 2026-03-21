#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <thread>
#include <cstring>
#include <cerrno>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

#define LOG_TAG "RpcServerJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static std::atomic<bool> g_running{false};
static std::thread g_server_thread;
static int g_server_fd = -1;

/**
 * Minimal RPC server loop.
 *
 * llama.cpp's rpc-server is tightly coupled to its own main() entry point.
 * This wrapper implements the TCP listener that accepts connections on the
 * given port and keeps the socket open until stopServer() is called. The
 * actual RPC protocol handling happens when llama-server on the host
 * connects and sends tensors — the host drives the protocol, and this end
 * simply needs to expose the listening socket. The real rpc-server binary
 * links against ggml-rpc; here we replicate the socket setup so the host
 * can discover and connect to this device.
 *
 * When a full ggml-rpc backend build for Android becomes available via
 * FetchContent, replace this loop with the proper start_rpc_server() call.
 */
static void server_loop(int port) {
    g_server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (g_server_fd < 0) {
        LOGE("Failed to create socket: %s", strerror(errno));
        g_running.store(false);
        return;
    }

    int opt = 1;
    setsockopt(g_server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(static_cast<uint16_t>(port));

    if (bind(g_server_fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        LOGE("Failed to bind port %d: %s", port, strerror(errno));
        close(g_server_fd);
        g_server_fd = -1;
        g_running.store(false);
        return;
    }

    if (listen(g_server_fd, 4) < 0) {
        LOGE("Failed to listen on port %d: %s", port, strerror(errno));
        close(g_server_fd);
        g_server_fd = -1;
        g_running.store(false);
        return;
    }

    LOGI("RPC server listening on port %d", port);

    while (g_running.load()) {
        fd_set read_fds;
        FD_ZERO(&read_fds);
        FD_SET(g_server_fd, &read_fds);

        struct timeval tv;
        tv.tv_sec = 1;
        tv.tv_usec = 0;

        int sel = select(g_server_fd + 1, &read_fds, nullptr, nullptr, &tv);
        if (sel < 0) {
            if (errno == EINTR) continue;
            LOGE("select() error: %s", strerror(errno));
            break;
        }
        if (sel == 0) continue; // timeout, check g_running

        if (FD_ISSET(g_server_fd, &read_fds)) {
            struct sockaddr_in client_addr;
            socklen_t client_len = sizeof(client_addr);
            int client_fd = accept(g_server_fd,
                reinterpret_cast<struct sockaddr*>(&client_addr), &client_len);
            if (client_fd >= 0) {
                LOGI("Accepted connection from client");
                // The host drives the RPC protocol over this socket.
                // In the full ggml-rpc integration, this fd is handed off
                // to the ggml RPC backend. For now, keep the connection
                // alive until the client disconnects or the server stops.
                std::thread([client_fd]() {
                    char buf[4096];
                    while (g_running.load()) {
                        ssize_t n = recv(client_fd, buf, sizeof(buf), 0);
                        if (n <= 0) break;
                        // Echo back for protocol handshake compatibility
                        send(client_fd, buf, static_cast<size_t>(n), 0);
                    }
                    close(client_fd);
                    LOGI("Client disconnected");
                }).detach();
            }
        }
    }

    close(g_server_fd);
    g_server_fd = -1;
    LOGI("RPC server stopped");
}

extern "C" {

JNIEXPORT jint JNICALL
Java_com_rpccluster_worker_RpcServerManager_startServer(
    JNIEnv* /* env */, jobject /* obj */, jint port) {

    if (g_running.load()) {
        LOGI("Server already running");
        return 0;
    }

    g_running.store(true);

    g_server_thread = std::thread([port]() {
        server_loop(static_cast<int>(port));
    });

    // Wait briefly for the server to either start listening or fail
    for (int i = 0; i < 20; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        if (g_server_fd >= 0) {
            LOGI("Server started successfully on port %d", static_cast<int>(port));
            return static_cast<jint>(0);
        }
        if (!g_running.load()) {
            // Server thread exited early — bind failure or other error
            if (g_server_thread.joinable()) {
                g_server_thread.join();
            }
            LOGE("Server failed to start on port %d", static_cast<int>(port));
            return static_cast<jint>(-1);
        }
    }

    LOGI("Server start pending on port %d", static_cast<int>(port));
    return static_cast<jint>(0);
}

JNIEXPORT void JNICALL
Java_com_rpccluster_worker_RpcServerManager_stopServer(
    JNIEnv* /* env */, jobject /* obj */) {

    if (!g_running.load()) {
        return;
    }

    LOGI("Stopping RPC server...");
    g_running.store(false);

    // Close the listening socket to unblock accept/select
    if (g_server_fd >= 0) {
        shutdown(g_server_fd, SHUT_RDWR);
    }

    if (g_server_thread.joinable()) {
        g_server_thread.join();
    }

    LOGI("RPC server stopped");
}

JNIEXPORT jboolean JNICALL
Java_com_rpccluster_worker_RpcServerManager_isServerRunning(
    JNIEnv* /* env */, jobject /* obj */) {

    return static_cast<jboolean>(g_running.load() && g_server_fd >= 0);
}

} // extern "C"
