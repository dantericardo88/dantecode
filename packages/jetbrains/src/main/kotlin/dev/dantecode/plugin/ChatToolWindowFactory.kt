package dev.dantecode.plugin

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import javax.swing.JPanel
import javax.swing.JTextArea
import javax.swing.JTextField
import javax.swing.JButton
import javax.swing.JScrollPane
import javax.swing.SwingUtilities
import java.awt.BorderLayout
import java.awt.Dimension

/**
 * Creates the DanteCode chat tool window.
 * Uses a simple Swing UI (JTextArea + JTextField) for the chat interface.
 * Communication goes through StdioBridge to the TypeScript core.
 */
class ChatToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ChatPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "Chat", false)
        toolWindow.contentManager.addContent(content)
    }
}

/**
 * Chat panel with message history and input field.
 */
class ChatPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val chatHistory = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        font = font.deriveFont(13f)
    }
    private val inputField = JTextField()
    private val sendButton = JButton("Send")

    init {
        // Chat history area
        val scrollPane = JScrollPane(chatHistory).apply {
            preferredSize = Dimension(400, 500)
        }
        add(scrollPane, BorderLayout.CENTER)

        // Input area
        val inputPanel = JPanel(BorderLayout()).apply {
            add(inputField, BorderLayout.CENTER)
            add(sendButton, BorderLayout.EAST)
        }
        add(inputPanel, BorderLayout.SOUTH)

        // Send action
        sendButton.addActionListener { sendMessage() }
        inputField.addActionListener { sendMessage() }
    }

    private fun sendMessage() {
        val text = inputField.text.trim()
        if (text.isEmpty()) return

        inputField.text = ""
        appendMessage("You", text)

        // Send to bridge in background thread
        Thread {
            try {
                val service = DanteCodeService.getInstance(project)
                val bridge = service.getBridge()
                val response = bridge.sendRequest("chat", mapOf("message" to text))
                SwingUtilities.invokeLater {
                    appendMessage("DanteCode", response)
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    appendMessage("Error", e.message ?: "Unknown error")
                }
            }
        }.start()
    }

    private fun appendMessage(sender: String, message: String) {
        chatHistory.append("[$sender]: $message\n\n")
        chatHistory.caretPosition = chatHistory.document.length
    }
}
