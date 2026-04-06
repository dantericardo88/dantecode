package dev.dantecode.plugin

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import java.awt.event.MouseEvent

/**
 * Displays the DanteForge PDSE score for the currently-active file in the
 * JetBrains status bar.
 *
 * Score thresholds:
 *   - >= 85  → green  "✓ PDSE: 92"
 *   - >= 70  → yellow "~ PDSE: 74"
 *   -  < 70  → red    "! PDSE: 61"
 *
 * The score is fetched by sending a `pdse_request` message through StdioBridge
 * whenever the active editor changes or a file is saved.
 */
class PdseStatusBarWidget(private val project: Project) :
    StatusBarWidget, StatusBarWidget.TextPresentation {

    companion object {
        const val ID = "DanteCode.PdseScore"
    }

    @Volatile
    private var displayText = "PDSE: —"

    @Volatile
    private var tooltipText = "DanteCode PDSE score (not yet computed)"

    private var statusBar: StatusBar? = null

    // ── StatusBarWidget ──────────────────────────────────────────────────────

    override fun ID(): String = ID

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar

        // Listen for active editor changes
        val connection = project.messageBus.connect(this)
        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    val file = event.newFile
                    if (file != null) {
                        refreshScore(file)
                    } else {
                        resetDisplay()
                    }
                }
            }
        )

        // Also listen for document saves via VirtualFileListener would require
        // a different API; for simplicity we rely on selectionChanged + manual refresh.
    }

    override fun dispose() {
        statusBar = null
    }

    // ── TextPresentation ─────────────────────────────────────────────────────

    override fun getText(): String = displayText

    override fun getTooltipText(): String = tooltipText

    override fun getAlignment(): Float = 0.5f

    override fun getClickConsumer(): Consumer<MouseEvent>? = Consumer {
        // On click: re-run PDSE for the current file
        val bar = statusBar ?: return@Consumer
        // Find current file from editor manager
        val editorManager = com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project)
        val file = editorManager.selectedFiles.firstOrNull()
        if (file != null) {
            refreshScore(file)
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private fun resetDisplay() {
        displayText = "PDSE: —"
        tooltipText = "No file selected"
        statusBar?.updateWidget(ID)
    }

    /**
     * Runs a background thread to fetch the PDSE score for [file] via the
     * StdioBridge `pdse_request` message.
     */
    fun refreshScore(file: VirtualFile) {
        val filePath = file.path

        // Update to loading state immediately
        displayText = "PDSE: …"
        tooltipText = "Computing PDSE score for ${file.name}…"
        statusBar?.updateWidget(ID)

        Thread {
            try {
                val service = DanteCodeService.getInstance(project)
                val bridge = service.getBridge()

                // Send pdse_request; bridge returns a JSON string with a "score" field.
                val raw = bridge.sendRequest(
                    "pdse_request",
                    mapOf("filePath" to filePath)
                )

                // Parse score from response (expects JSON like {"score": 87})
                val score = parseScore(raw)

                ApplicationManager.getApplication().invokeLater {
                    if (score != null) {
                        val (icon, label) = formatScore(score)
                        displayText = "$icon PDSE: $score"
                        tooltipText = "$label — ${file.name} scored $score/100"
                    } else {
                        displayText = "PDSE: ?"
                        tooltipText = "Could not parse PDSE score for ${file.name}"
                    }
                    statusBar?.updateWidget(ID)
                }
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    displayText = "PDSE: !"
                    tooltipText = "PDSE score error: ${e.message}"
                    statusBar?.updateWidget(ID)
                }
            }
        }.also { it.isDaemon = true }.start()
    }

    /** Extracts the numeric score from a JSON response string. */
    private fun parseScore(raw: String): Int? {
        // Accept both {"score":87} and plain "87"
        val plainInt = raw.trim().toIntOrNull()
        if (plainInt != null) return plainInt

        val match = Regex(""""score"\s*:\s*(\d+)""").find(raw)
        return match?.groupValues?.getOrNull(1)?.toIntOrNull()
    }

    /** Returns (icon, label) based on the score value. */
    private fun formatScore(score: Int): Pair<String, String> = when {
        score >= 85 -> Pair("✓", "Passed")
        score >= 70 -> Pair("~", "Warning")
        else -> Pair("!", "Failed")
    }
}

/**
 * Factory that registers the PDSE status bar widget with the JetBrains
 * extension point system.
 */
class PdseStatusBarWidgetFactory : StatusBarWidgetFactory {

    override fun getId(): String = PdseStatusBarWidget.ID

    override fun getDisplayName(): String = "DanteCode PDSE Score"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget =
        PdseStatusBarWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) {
        Disposer.dispose(widget)
    }

    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}
