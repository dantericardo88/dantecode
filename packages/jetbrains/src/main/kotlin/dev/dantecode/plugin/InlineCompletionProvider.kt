package dev.dantecode.plugin

import com.intellij.codeInsight.completion.*
import com.intellij.codeInsight.lookup.LookupElementBuilder
import com.intellij.openapi.diagnostic.Logger
import com.intellij.patterns.PlatformPatterns
import com.intellij.util.ProcessingContext
import java.util.concurrent.Future
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Provides inline code completions by delegating to the TypeScript FIM engine
 * via the stdio bridge.
 *
 * Robustness:
 * - 300ms debounce: requests are skipped if the user types again within 300ms
 * - Cancel in-flight: previous completion request is cancelled when a new one arrives
 * - Non-blocking: completions run in a background thread pool with a timeout
 */
class InlineCompletionProvider : CompletionContributor() {
    private val log = Logger.getInstance(InlineCompletionProvider::class.java)

    /** Single-thread executor for serialized completion requests. */
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "DanteCode-Completion").apply { isDaemon = true }
    }

    /** Tracks the last keystroke time for debouncing. */
    private val lastKeystrokeTime = AtomicLong(0)

    /** Reference to the currently in-flight completion future, so we can cancel it. */
    private val inflightRequest = AtomicReference<Future<*>?>(null)

    companion object {
        /** Minimum delay between keystrokes before a completion request fires. */
        const val DEBOUNCE_MS = 300L
        /** Maximum time to wait for a completion response. */
        const val COMPLETION_TIMEOUT_MS = 5000L
    }

    init {
        extend(
            CompletionType.BASIC,
            PlatformPatterns.psiElement(),
            object : CompletionProvider<CompletionParameters>() {
                override fun addCompletions(
                    parameters: CompletionParameters,
                    context: ProcessingContext,
                    result: CompletionResultSet
                ) {
                    val project = parameters.editor.project ?: return
                    val document = parameters.editor.document
                    val offset = parameters.offset

                    val prefix = document.text.substring(0, offset)
                    val suffix = document.text.substring(offset)
                    val filePath = parameters.originalFile.virtualFile?.path ?: return
                    val language = parameters.originalFile.language.id

                    // Record keystroke time for debouncing
                    val now = System.currentTimeMillis()
                    lastKeystrokeTime.set(now)

                    // Cancel any in-flight request
                    inflightRequest.getAndSet(null)?.cancel(true)

                    try {
                        val service = DanteCodeService.getInstance(project)
                        if (!service.isConnected()) return

                        val bridge = service.getBridge()

                        val future = executor.submit<String?> {
                            // Debounce: wait and check if a newer keystroke arrived
                            Thread.sleep(DEBOUNCE_MS)
                            if (lastKeystrokeTime.get() != now) {
                                return@submit null // User typed again, skip this request
                            }

                            bridge.sendRequest("complete", mapOf(
                                "filePath" to filePath,
                                "prefix" to prefix,
                                "suffix" to suffix,
                                "language" to language
                            ))
                        }
                        inflightRequest.set(future)

                        // Wait with timeout — don't block the editor forever
                        val completion = try {
                            future.get(COMPLETION_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                        } catch (_: java.util.concurrent.TimeoutException) {
                            future.cancel(true)
                            log.debug("DanteCode completion timed out for $filePath")
                            null
                        } catch (_: java.util.concurrent.CancellationException) {
                            null // Cancelled by a newer request — expected
                        }

                        if (completion != null && completion.isNotEmpty()) {
                            result.addElement(
                                LookupElementBuilder.create(completion)
                                    .withPresentableText(completion.take(50))
                                    .withTypeText("DanteCode")
                                    .bold()
                            )
                        }
                    } catch (e: Exception) {
                        log.debug("DanteCode completion failed: ${e.message}")
                    }
                }
            }
        )
    }
}
