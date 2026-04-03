package dev.dantecode.plugin

import com.intellij.codeInsight.completion.*
import com.intellij.codeInsight.lookup.LookupElementBuilder
import com.intellij.openapi.diagnostic.Logger
import com.intellij.patterns.PlatformPatterns
import com.intellij.util.ProcessingContext

/**
 * Provides inline code completions by delegating to the TypeScript FIM engine
 * via the stdio bridge. Completions are fetched asynchronously.
 */
class InlineCompletionProvider : CompletionContributor() {
    private val log = Logger.getInstance(InlineCompletionProvider::class.java)

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

                    try {
                        val service = DanteCodeService.getInstance(project)
                        if (!service.isConnected()) return

                        val bridge = service.getBridge()
                        val completion = bridge.sendRequest("complete", mapOf(
                            "filePath" to filePath,
                            "prefix" to prefix,
                            "suffix" to suffix,
                            "language" to language
                        ))

                        if (completion.isNotEmpty()) {
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
