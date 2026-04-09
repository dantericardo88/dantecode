package dev.dantecode.plugin

/**
 * JSON-RPC method names used between the JetBrains plugin and the DanteCode CLI stdio bridge.
 * Centralised here so any rename only requires changing one file.
 */
object DanteCodeMessages {
    /** Chat message: params = {message: String, filePath?: String, context?: String} */
    const val CHAT_REQUEST = "chat"

    /** Fill-in-middle completion: params = {filePath: String, prefix: String, suffix: String, language: String} */
    const val COMPLETE_REQUEST = "complete"

    /** DanteForge PDSE verification: params = {filePath: String} */
    const val VERIFY_REQUEST = "verify"

    /** PDSE score only (lighter than full verify): params = {filePath: String} */
    const val PDSE_SCORE_REQUEST = "pdse_request"

    /** Ping to check bridge liveness: params = {} */
    const val PING_REQUEST = "ping"
}
