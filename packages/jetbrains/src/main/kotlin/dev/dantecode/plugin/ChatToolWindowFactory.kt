package dev.dantecode.plugin

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import javax.swing.*
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Font

/**
 * Creates the DanteCode chat tool window.
 * Attempts to use JCEF (Chromium) for a rich HTML-based chat UI.
 * Falls back to a simple Swing UI (JTextArea + JTextField) if JCEF is not available
 * (older IDEs or headless environments).
 *
 * Shows a loading indicator while the StdioBridge connection is being established.
 * Shows an error panel with install instructions if the DanteCode CLI is not found.
 */
class ChatToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = if (isJcefAvailable()) {
            JcefChatPanel(project)
        } else {
            SwingChatPanel(project)
        }
        val content = ContentFactory.getInstance().createContent(panel, "Chat", false)
        toolWindow.contentManager.addContent(content)
    }

    private fun isJcefAvailable(): Boolean {
        return try {
            JBCefBrowserBase.isSupportedAndEnabled()
        } catch (_: Throwable) {
            false
        }
    }
}

// ---------------------------------------------------------------------------
// JCEF (Chromium) chat panel — rich HTML UI
// ---------------------------------------------------------------------------

/**
 * Chat panel using JBCefBrowser for rich HTML rendering.
 */
class JcefChatPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val log = Logger.getInstance(JcefChatPanel::class.java)
    private val browser: JBCefBrowser = JBCefBrowser()
    private val sendQuery: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    init {
        // Wire the JS→Kotlin send handler
        sendQuery.addHandler { message ->
            Thread({
                try {
                    val service = DanteCodeService.getInstance(project)
                    val bridge = service.getBridge()
                    val response = bridge.sendRequest(DanteCodeMessages.CHAT_REQUEST, mapOf("message" to message))
                    browser.cefBrowser.executeJavaScript(
                        "addMsg('DanteCode', ${jsString(response)}, false); enableInput();",
                        browser.url, 0
                    )
                } catch (e: Exception) {
                    browser.cefBrowser.executeJavaScript(
                        "addMsg('Error', ${jsString(e.message ?: "Unknown error")}, true); enableInput();",
                        browser.url, 0
                    )
                }
            }, "DanteCode-JCEF-Send").start()
            null  // null = success (no synchronous response needed)
        }
        add(browser.component, BorderLayout.CENTER)
        showLoading()
        connectBridge()
    }

    override fun removeNotify() {
        super.removeNotify()
        sendQuery.dispose()
        browser.dispose()
    }

    private fun showLoading() {
        browser.loadHTML("""
            <!DOCTYPE html>
            <html><head><style>
            body { background: #1e1e1e; color: #ccc; font-family: sans-serif;
                   display: flex; align-items: center; justify-content: center; height: 100vh; }
            .spinner { border: 3px solid #333; border-top: 3px solid #58a6ff; border-radius: 50%;
                       width: 32px; height: 32px; animation: spin 1s linear infinite; margin-right: 12px; }
            @keyframes spin { to { transform: rotate(360deg); } }
            </style></head><body>
            <div class="spinner"></div><span>Connecting to DanteCode CLI...</span>
            </body></html>
        """.trimIndent())
    }

    private fun showError(message: String) {
        browser.loadHTML("""
            <!DOCTYPE html>
            <html><head><style>
            body { background: #1e1e1e; color: #ccc; font-family: sans-serif;
                   display: flex; align-items: center; justify-content: center; height: 100vh;
                   flex-direction: column; gap: 16px; padding: 24px; }
            .title { color: #f85149; font-size: 18px; font-weight: bold; }
            .instructions { background: #161b22; padding: 16px; border-radius: 8px;
                           border: 1px solid #30363d; font-family: monospace; font-size: 13px;
                           white-space: pre-wrap; max-width: 500px; }
            .hint { color: #8b949e; font-size: 13px; }
            </style></head><body>
            <div class="title">DanteCode CLI Not Found</div>
            <div class="instructions">${escapeHtml(message)}</div>
            <div class="hint">After installing, restart the IDE or reopen this panel.</div>
            </body></html>
        """.trimIndent())
    }

    private fun showChat() {
        browser.loadHTML("""
            <!DOCTYPE html>
            <html><head><style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #1e1e1e; color: #c9d1d9; font-family: -apple-system, sans-serif;
                   display: flex; flex-direction: column; height: 100vh; }
            #history { flex: 1; overflow-y: auto; padding: 16px; }
            .msg { margin-bottom: 12px; line-height: 1.5; }
            .msg .sender { font-weight: bold; color: #58a6ff; }
            .msg.error .sender { color: #f85149; }
            #input-area { display: flex; padding: 8px; border-top: 1px solid #30363d; }
            #prompt { flex: 1; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d;
                      border-radius: 6px; padding: 8px 12px; font-size: 14px; outline: none; }
            #prompt:focus { border-color: #58a6ff; }
            #send { background: #238636; color: #fff; border: none; border-radius: 6px;
                    padding: 8px 16px; margin-left: 8px; cursor: pointer; font-size: 14px; }
            #send:hover { background: #2ea043; }
            #send:disabled, #prompt:disabled { opacity: 0.5; cursor: not-allowed; }
            </style></head><body>
            <div id="history"></div>
            <div id="input-area">
              <input id="prompt" type="text" placeholder="Ask DanteCode..." autofocus>
              <button id="send">Send</button>
            </div>
            <script>
            const historyEl = document.getElementById('history');
            const promptEl  = document.getElementById('prompt');
            const sendBtn   = document.getElementById('send');
            function addMsg(sender, text, isError) {
              const div = document.createElement('div');
              div.className = 'msg' + (isError ? ' error' : '');
              const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              div.innerHTML = '<span class="sender">' + sender + ':</span> ' + escaped;
              historyEl.appendChild(div);
              historyEl.scrollTop = historyEl.scrollHeight;
            }
            function enableInput() {
              sendBtn.disabled = false;
              promptEl.disabled = false;
              promptEl.focus();
            }
            function sendMessage() {
              const text = promptEl.value.trim();
              if (!text) return;
              addMsg('You', text, false);
              promptEl.value = '';
              sendBtn.disabled = true;
              promptEl.disabled = true;
              // __sendToKotlin__ is injected by Kotlin via JBCefJSQuery after page load
              window.__sendToKotlin__.request(text,
                function(_r) { /* success handled server-side via addMsg callback */ },
                function(_code, msg) { addMsg('Error', msg, true); enableInput(); }
              );
            }
            sendBtn.addEventListener('click', sendMessage);
            promptEl.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); });
            addMsg('DanteCode', 'Connected. How can I help?', false);
            </script>
            </body></html>
        """.trimIndent())
        // Inject the JBCefJSQuery bridge function once the page has loaded
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain == true) {
                    b?.executeJavaScript(sendQuery.inject("__sendToKotlin__"), b.url, 0)
                }
            }
        }, browser.cefBrowser)
    }

    private fun connectBridge() {
        Thread({
            try {
                val service = DanteCodeService.getInstance(project)
                service.getBridge() // triggers lazy init + connection
                SwingUtilities.invokeLater { showChat() }
            } catch (e: Exception) {
                log.warn("DanteCode bridge connection failed: ${e.message}")
                SwingUtilities.invokeLater {
                    showError(e.message ?: "Failed to connect to DanteCode CLI")
                }
            }
        }, "DanteCode-JCEF-Connect").start()
    }

    private fun escapeHtml(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    /** Wraps [s] in single quotes and escapes for safe embedding in a JS string literal. */
    private fun jsString(s: String): String {
        val escaped = s
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("</", "<\\/")  // prevent </script> injection
        return "'$escaped'"
    }
}

// ---------------------------------------------------------------------------
// Swing fallback chat panel — works in all IDEs
// ---------------------------------------------------------------------------

/**
 * Fallback chat panel using pure Swing. Used when JCEF is not available.
 */
class SwingChatPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val log = Logger.getInstance(SwingChatPanel::class.java)
    private val chatHistory = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        font = Font(Font.MONOSPACED, Font.PLAIN, 13)
    }
    private val inputField = JTextField()
    private val sendButton = JButton("Send")
    private val statusLabel = JLabel("Connecting to DanteCode CLI...")

    init {
        // Status bar at top
        val statusPanel = JPanel(BorderLayout()).apply {
            add(statusLabel, BorderLayout.CENTER)
            border = BorderFactory.createEmptyBorder(4, 8, 4, 8)
        }
        add(statusPanel, BorderLayout.NORTH)

        // Chat history area
        val scrollPane = JScrollPane(chatHistory).apply {
            preferredSize = Dimension(400, 500)
        }
        add(scrollPane, BorderLayout.CENTER)

        // Input area (initially disabled)
        inputField.isEnabled = false
        sendButton.isEnabled = false
        val inputPanel = JPanel(BorderLayout()).apply {
            add(inputField, BorderLayout.CENTER)
            add(sendButton, BorderLayout.EAST)
        }
        add(inputPanel, BorderLayout.SOUTH)

        // Send action
        sendButton.addActionListener { sendMessage() }
        inputField.addActionListener { sendMessage() }

        // Connect in background
        connectBridge()
    }

    private fun connectBridge() {
        Thread({
            try {
                val service = DanteCodeService.getInstance(project)
                service.getBridge()
                SwingUtilities.invokeLater {
                    statusLabel.text = "Connected"
                    inputField.isEnabled = true
                    sendButton.isEnabled = true
                    inputField.requestFocusInWindow()
                }
            } catch (e: Exception) {
                log.warn("DanteCode bridge connection failed: ${e.message}")
                SwingUtilities.invokeLater {
                    statusLabel.text = "Disconnected"
                    appendMessage("Error", e.message ?: "Failed to connect to DanteCode CLI")
                    appendMessage("Hint", "Install with: npm install -g @dantecode/cli\n" +
                        "Then restart the IDE or reopen this panel.")
                }
            }
        }, "DanteCode-Swing-Connect").start()
    }

    private fun sendMessage() {
        val text = inputField.text.trim()
        if (text.isEmpty()) return

        inputField.text = ""
        appendMessage("You", text)

        // Disable input while waiting
        inputField.isEnabled = false
        sendButton.isEnabled = false

        // Send to bridge in background thread
        Thread({
            try {
                val service = DanteCodeService.getInstance(project)
                val bridge = service.getBridge()
                val response = bridge.sendRequest("chat", mapOf("message" to text))
                SwingUtilities.invokeLater {
                    appendMessage("DanteCode", response)
                    inputField.isEnabled = true
                    sendButton.isEnabled = true
                    inputField.requestFocusInWindow()
                }
            } catch (e: Exception) {
                SwingUtilities.invokeLater {
                    appendMessage("Error", e.message ?: "Unknown error")
                    inputField.isEnabled = true
                    sendButton.isEnabled = true
                }
            }
        }, "DanteCode-Chat-Send").start()
    }

    private fun appendMessage(sender: String, message: String) {
        chatHistory.append("[$sender]: $message\n\n")
        chatHistory.caretPosition = chatHistory.document.length
    }
}
