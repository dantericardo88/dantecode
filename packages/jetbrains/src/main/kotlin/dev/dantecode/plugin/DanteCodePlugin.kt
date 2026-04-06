package dev.dantecode.plugin

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.Disposable

/**
 * Project-level service managing the DanteCode stdio bridge.
 * Lazily starts the bridge on first access and shuts it down
 * when the project closes.
 *
 * Process death triggers a balloon notification to the user.
 */
@Service(Service.Level.PROJECT)
class DanteCodeService(private val project: Project) : Disposable {
    private val log = Logger.getInstance(DanteCodeService::class.java)
    @Volatile private var bridge: StdioBridge? = null
    @Volatile private var cliNotFound = false

    /**
     * Get (or lazily create) the StdioBridge instance.
     * If the CLI binary cannot be found, throws with a descriptive message.
     */
    fun getBridge(): StdioBridge {
        if (cliNotFound) {
            throw RuntimeException(CLI_NOT_FOUND_MESSAGE)
        }

        val existing = bridge
        if (existing != null && existing.isAlive()) {
            return existing
        }

        synchronized(this) {
            // Double-check after acquiring lock
            val current = bridge
            if (current != null && current.isAlive()) {
                return current
            }

            val newBridge = StdioBridge(project.basePath ?: ".")
            newBridge.onProcessDied = { message ->
                notifyUser("DanteCode CLI Disconnected", message, NotificationType.ERROR)
            }

            try {
                newBridge.start()
            } catch (e: RuntimeException) {
                cliNotFound = true
                val msg = "DanteCode CLI not found. Please install it:\n" +
                    "  npm install -g @dantecode/cli\n" +
                    "or ensure 'node' and 'dantecode' are on your PATH."
                notifyUser("DanteCode CLI Not Found", msg, NotificationType.ERROR)
                throw RuntimeException(msg, e)
            }

            bridge = newBridge
            log.info("DanteCode bridge started for project: ${project.name}")
            return newBridge
        }
    }

    fun isConnected(): Boolean = bridge?.isAlive() == true

    /**
     * Reset the cliNotFound flag so the next getBridge() retries.
     * Useful after the user installs the CLI.
     */
    fun resetConnectionState() {
        cliNotFound = false
    }

    override fun dispose() {
        bridge?.stop()
        bridge = null
        log.info("DanteCode bridge stopped for project: ${project.name}")
    }

    private fun notifyUser(title: String, content: String, type: NotificationType) {
        try {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("DanteCode Notifications")
                .createNotification(title, content, type)
                .notify(project)
        } catch (e: Exception) {
            log.warn("Failed to show notification: ${e.message}")
        }
    }

    companion object {
        const val CLI_NOT_FOUND_MESSAGE = "DanteCode CLI is not installed or not on PATH. " +
            "Install with: npm install -g @dantecode/cli"

        fun getInstance(project: Project): DanteCodeService =
            project.getService(DanteCodeService::class.java)
    }
}
