package dev.dantecode.plugin

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.diagnostic.Logger
import java.io.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Manages a stdio connection to the DanteCode TypeScript CLI.
 * Uses JSON-RPC 2.0 protocol for request/response communication.
 *
 * The bridge spawns `node` with the CLI entry point and communicates
 * via stdin/stdout using newline-delimited JSON.
 *
 * Lifecycle:
 * - Lazy init: started on first sendRequest() or explicit start()
 * - Auto-reconnect on process death with exponential backoff (max 3 retries)
 * - Clean shutdown via stop() — called by DanteCodeService.dispose()
 * - Process death triggers notification to user
 */
class StdioBridge(
    private val projectRoot: String,
    private val requestTimeoutSeconds: Long = 30L,
    private val maxReconnectAttempts: Int = 3,
    /** Callback invoked on the reader thread when the process dies unexpectedly. */
    var onProcessDied: ((message: String) -> Unit)? = null
) {
    private val log = Logger.getInstance(StdioBridge::class.java)
    private val gson = Gson()
    @Volatile private var process: Process? = null
    @Volatile private var writer: BufferedWriter? = null
    @Volatile private var readerThread: Thread? = null
    private val requestId = AtomicInteger(0)
    private val pendingRequests = ConcurrentHashMap<Int, PendingRequest>()
    private val started = AtomicBoolean(false)
    private val shuttingDown = AtomicBoolean(false)
    private val reconnectAttempts = AtomicInteger(0)

    private data class PendingRequest(
        val latch: CountDownLatch = CountDownLatch(1),
        var result: String? = null,
        var error: String? = null
    )

    /**
     * Start the subprocess. Safe to call multiple times — only the first call
     * (or after stop()) actually spawns a process.
     */
    @Synchronized
    fun start() {
        if (started.get() && isAlive()) return
        shuttingDown.set(false)

        val nodeCommand = findNodeExecutable()
        val cliPath = findCLIPath()

        log.info("DanteCode bridge starting: $nodeCommand $cliPath --stdio (project=$projectRoot)")

        val processBuilder = ProcessBuilder(nodeCommand, cliPath, "--stdio")
            .directory(File(projectRoot))
            .redirectErrorStream(false)

        try {
            process = processBuilder.start()
        } catch (e: IOException) {
            log.error("Failed to start DanteCode CLI process: ${e.message}", e)
            throw RuntimeException("Failed to start DanteCode CLI: ${e.message}", e)
        }

        writer = BufferedWriter(OutputStreamWriter(process!!.outputStream))

        // Capture stderr to IntelliJ log instead of dropping it
        val stderrThread = Thread({
            val errReader = BufferedReader(InputStreamReader(process!!.errorStream))
            try {
                var line: String?
                while (errReader.readLine().also { line = it } != null) {
                    log.warn("DanteCode CLI stderr: $line")
                }
            } catch (_: IOException) {
                // Process closed — expected during shutdown
            }
        }, "DanteCode-StdioBridge-Stderr")
        stderrThread.isDaemon = true
        stderrThread.start()

        // Start reader thread for responses
        readerThread = Thread({
            val reader = BufferedReader(InputStreamReader(process!!.inputStream))
            try {
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    handleResponse(line!!)
                }
            } catch (e: IOException) {
                if (!shuttingDown.get()) {
                    log.warn("DanteCode bridge reader error: ${e.message}")
                }
            }
            // If we get here, the process stdout closed — process likely died
            if (!shuttingDown.get()) {
                handleProcessDeath()
            }
        }, "DanteCode-StdioBridge-Reader")
        readerThread!!.isDaemon = true
        readerThread!!.start()

        started.set(true)
        reconnectAttempts.set(0)
        log.info("DanteCode stdio bridge started successfully")
    }

    /**
     * Send a JSON-RPC request and wait for the response.
     * Lazily starts the bridge if not yet started.
     *
     * @throws RuntimeException on timeout (default 30s), bridge errors, or if the process is dead
     */
    fun sendRequest(method: String, params: Map<String, Any>): String {
        ensureStarted()

        if (!isAlive()) {
            throw RuntimeException("DanteCode CLI process is not running")
        }

        val id = requestId.incrementAndGet()
        val pending = PendingRequest()
        pendingRequests[id] = pending

        val request = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            addProperty("method", method)
            add("params", gson.toJsonTree(params))
        }

        try {
            synchronized(this) {
                val w = writer ?: throw RuntimeException("DanteCode bridge writer is closed")
                w.write(gson.toJson(request))
                w.newLine()
                w.flush()
            }
        } catch (e: IOException) {
            pendingRequests.remove(id)
            log.warn("Failed to write to DanteCode bridge: ${e.message}")
            throw RuntimeException("Failed to send request to DanteCode CLI: ${e.message}", e)
        }

        // Wait for response with timeout
        if (!pending.latch.await(requestTimeoutSeconds, TimeUnit.SECONDS)) {
            pendingRequests.remove(id)
            throw RuntimeException("DanteCode request '$method' timed out after ${requestTimeoutSeconds}s")
        }

        pendingRequests.remove(id)

        if (pending.error != null) {
            throw RuntimeException("DanteCode error: ${pending.error}")
        }

        return pending.result ?: ""
    }

    fun isAlive(): Boolean = process?.isAlive == true

    /**
     * Clean shutdown: close writer, destroy process, interrupt reader.
     * All pending requests are cancelled with an error.
     */
    @Synchronized
    fun stop() {
        shuttingDown.set(true)
        started.set(false)

        // Cancel all pending requests
        for ((_, pending) in pendingRequests) {
            pending.error = "Bridge shutting down"
            pending.latch.countDown()
        }
        pendingRequests.clear()

        try {
            writer?.close()
        } catch (e: Exception) {
            log.debug("Error closing DanteCode bridge writer: ${e.message}")
        }
        try {
            process?.let { p ->
                if (p.isAlive) {
                    // Try graceful shutdown first
                    p.destroy()
                    if (!p.waitFor(3, TimeUnit.SECONDS)) {
                        p.destroyForcibly()
                    }
                }
            }
        } catch (e: Exception) {
            log.debug("Error stopping DanteCode bridge process: ${e.message}")
        }
        try {
            readerThread?.interrupt()
        } catch (e: Exception) {
            log.debug("Error interrupting DanteCode bridge reader: ${e.message}")
        }

        process = null
        writer = null
        readerThread = null
        log.info("DanteCode stdio bridge stopped")
    }

    /**
     * Lazily start the bridge on first use.
     */
    private fun ensureStarted() {
        if (!started.get() || !isAlive()) {
            start()
        }
    }

    /**
     * Handle unexpected process death: cancel pending requests, attempt reconnect
     * with exponential backoff, notify user on final failure.
     */
    private fun handleProcessDeath() {
        log.warn("DanteCode CLI process died unexpectedly")

        // Cancel all pending requests
        for ((_, pending) in pendingRequests) {
            pending.error = "DanteCode CLI process died"
            pending.latch.countDown()
        }
        pendingRequests.clear()

        // Attempt reconnect with exponential backoff
        val attempt = reconnectAttempts.incrementAndGet()
        if (attempt <= maxReconnectAttempts) {
            val delayMs = (1000L * (1L shl (attempt - 1))).coerceAtMost(8000L) // 1s, 2s, 4s
            log.info("DanteCode bridge reconnect attempt $attempt/$maxReconnectAttempts in ${delayMs}ms")
            try {
                Thread.sleep(delayMs)
                if (!shuttingDown.get()) {
                    started.set(false)
                    start()
                    log.info("DanteCode bridge reconnected successfully on attempt $attempt")
                    return
                }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (e: Exception) {
                log.warn("DanteCode bridge reconnect attempt $attempt failed: ${e.message}")
            }
        }

        // All reconnect attempts exhausted — notify user
        val message = "DanteCode CLI process terminated unexpectedly after $maxReconnectAttempts reconnect attempts. " +
            "Please restart the IDE or check the DanteCode CLI installation."
        log.error(message)
        onProcessDied?.invoke(message)
    }

    private fun handleResponse(line: String) {
        try {
            val json = gson.fromJson(line, JsonObject::class.java) ?: return
            val id = json.get("id")?.asInt ?: return
            val pending = pendingRequests[id] ?: return

            if (json.has("error")) {
                val error = json.getAsJsonObject("error")
                pending.error = error.get("message")?.asString ?: "Unknown error"
            } else if (json.has("result")) {
                pending.result = json.get("result")?.asString ?: ""
            }

            pending.latch.countDown()
        } catch (e: Exception) {
            log.warn("Failed to parse DanteCode response: ${e.message}")
        }
    }

    private fun findNodeExecutable(): String {
        // Try common node locations
        val candidates = listOf("node", "/usr/local/bin/node", "/usr/bin/node")
        for (candidate in candidates) {
            try {
                val test = ProcessBuilder(candidate, "--version")
                    .redirectErrorStream(true)
                    .start()
                if (test.waitFor(5, TimeUnit.SECONDS) && test.exitValue() == 0) {
                    return candidate
                }
            } catch (_: Exception) { }
        }
        return "node" // fallback, hope it's on PATH
    }

    private fun findCLIPath(): String {
        // Look for the CLI relative to the project root
        val candidates = listOf(
            "$projectRoot/node_modules/.bin/dantecode",
            "$projectRoot/packages/cli/dist/index.js",
            "$projectRoot/node_modules/@dantecode/cli/dist/index.js"
        )
        for (candidate in candidates) {
            if (File(candidate).exists()) return candidate
        }
        return "dantecode" // fallback to global install
    }
}
