package dev.dantecode.plugin.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import dev.dantecode.plugin.DanteCodeService

class RunVerificationAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
        val filePath = editor.virtualFile?.path ?: return

        Thread {
            try {
                val service = DanteCodeService.getInstance(project)
                val bridge = service.getBridge()
                val result = bridge.sendRequest("verify", mapOf("filePath" to filePath))

                NotificationGroupManager.getInstance()
                    .getNotificationGroup("DanteCode Notifications")
                    .createNotification("DanteForge Verification", result, NotificationType.INFORMATION)
                    .notify(project)
            } catch (ex: Exception) {
                NotificationGroupManager.getInstance()
                    .getNotificationGroup("DanteCode Notifications")
                    .createNotification("Verification Failed", ex.message ?: "Unknown error", NotificationType.ERROR)
                    .notify(project)
            }
        }.start()
    }
}
