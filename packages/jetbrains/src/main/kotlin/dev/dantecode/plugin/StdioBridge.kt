package dev.dantecode.plugin

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.diagnostic.Logger
import java.io.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Manages a stdio connection to the DanteCode TypeScript CLI.
 * Uses JSON-RPC 2.0 protocol for request/response communication.
 *
 * The bridge spawns `node` with the CLI entry point and communicates
 * via stdin/stdout using newline-delimited JSON.
 */
class StdioBridge(private val projectRoot: String) {
    private val log = Logger.getInstance(StdioBridge::class.java)
    private val gson = Gson()
    private var process: Process? = null
    private var writer: BufferedWriter? = null
    private var readerThread: Thread? = null
    private val requestId = AtomicInteger(0)
    private val pendingRequests = ConcurrentHashMap<Int, PendingRequest>()

    private data class PendingRequest(
        val latch: CountDownLatch = CountDownLatch(1),
        var result: String? = null,
        var error: String? = null
    )

    fun start() {
        val nodeCommand = findNodeExecutable()
        val cliPath = findCLIPath()

        val processBuilder = ProcessBuilder(nodeCommand, cliPath, "--stdio")
            .directory(File(projectRoot))
            .redirectErrorStream(false)

        process = processBuilder.start()
        writer = BufferedWriter(OutputStreamWriter(process!!.outputStream))

        // Start reader thread for responses
        readerThread = Thread({
            val reader = BufferedReader(InputStreamReader(process!!.inputStream))
            try {
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    handleResponse(line!!)
                }
            } catch (e: IOException) {
                if (isAlive()) {
                    log.warn("DanteCode bridge reader error: ${e.message}")
                }
            }
        }, "DanteCode-StdioBridge-Reader")
        readerThread!!.isDaemon = true
        readerThread!!.start()

        log.info("DanteCode stdio bridge started: $nodeCommand $cliPath")
    }

    fun sendRequest(method: String, params: Map<String, Any>): String {
        val id = requestId.incrementAndGet()
        val pending = PendingRequest()
        pendingRequests[id] = pending

        val request = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            addProperty("method", method)
            add("params", gson.toJsonTree(params))
        }

        synchronized(this) {
            writer?.write(gson.toJson(request))
            writer?.newLine()
            writer?.flush()
        }

        // Wait for response with timeout
        if (!pending.latch.await(60, TimeUnit.SECONDS)) {
            pendingRequests.remove(id)
            throw RuntimeException("DanteCode request timed out after 60s")
        }

        pendingRequests.remove(id)

        if (pending.error != null) {
            throw RuntimeException("DanteCode error: ${pending.error}")
        }

        return pending.result ?: ""
    }

    fun isAlive(): Boolean = process?.isAlive == true

    fun stop() {
        try {
            writer?.close()
            process?.destroyForcibly()
            readerThread?.interrupt()
        } catch (e: Exception) {
            log.debug("Error stopping DanteCode bridge: ${e.message}")
        }
        process = null
        writer = null
        readerThread = null
        pendingRequests.clear()
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
            log.debug("Failed to parse DanteCode response: ${e.message}")
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
                test.waitFor(5, TimeUnit.SECONDS)
                if (test.exitValue() == 0) return candidate
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
