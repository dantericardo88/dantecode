package dev.dantecode.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import dev.dantecode.plugin.DanteCodeMessages
import dev.dantecode.plugin.DanteCodeService
import dev.dantecode.plugin.PdseStatusBarWidget

/**
 * Runs DanteForge inline verification on the currently active file.
 *
 * Keyboard shortcut: Ctrl+Shift+V (registered in plugin.xml).
 *
 * On completion the result is shown as a balloon notification and the PDSE
 * status-bar widget is refreshed so the score updates immediately.
 */
class RunVerificationAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editorManager = FileEditorManager.getInstance(project)
        val editor = editorManager.selectedTextEditor ?: return
        val filePath = editor.virtualFile?.path ?: return

        Thread {
            try {
                val service = DanteCodeService.getInstance(project)
                val bridge = service.getBridge()
                val result = bridge.sendRequest(
                    DanteCodeMessages.VERIFY_REQUEST,
                    mapOf("filePath" to filePath)
                )

                NotificationGroupManager.getInstance()
                    .getNotificationGroup("DanteCode Notifications")
                    .createNotification("DanteForge Verification", result, NotificationType.INFORMATION)
                    .notify(project)

                // Refresh the PDSE status-bar widget for the current file
                val virtualFile = editor.virtualFile
                if (virtualFile != null) {
                    val statusBar = com.intellij.openapi.wm.WindowManager.getInstance()
                        .getStatusBar(project)
                    val widget = statusBar?.getWidget(PdseStatusBarWidget.ID) as? PdseStatusBarWidget
                    widget?.refreshScore(virtualFile)
                }
            } catch (ex: Exception) {
                NotificationGroupManager.getInstance()
                    .getNotificationGroup("DanteCode Notifications")
                    .createNotification(
                        "Verification Failed",
                        ex.message ?: "Unknown error",
                        NotificationType.ERROR
                    )
                    .notify(project)
            }
        }.also { it.isDaemon = true }.start()
    }
}
