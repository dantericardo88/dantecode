// ============================================================================
// DanteCode Cmd+K Inline Edit Provider
// Cursor-style inline editing: select code → describe change → AI applies it
// ============================================================================

import * as vscode from "vscode";
import { ModelRouterImpl } from "@dantecode/core";
import type { ModelRouterConfig, ModelConfig } from "@dantecode/config-types";

/** VSCode secret storage keys for provider API keys */
const PROVIDER_SECRET_KEYS: Record<string, string> = {
  grok: "dantecode.grokApiKey",
  anthropic: "dantecode.anthropicApiKey",
  openai: "dantecode.openaiApiKey",
  google: "dantecode.googleApiKey",
};

/**
 * Inline Edit Provider — handles Cmd+K edit flow
 */
export class InlineEditProvider {
  private currentModel: string;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    defaultModel: string,
  ) {
    this.currentModel = defaultModel;
  }

  /** Update active model (called when user switches model) */
  updateModel(modelId: string): void {
    this.currentModel = modelId;
  }

  /**
   * Execute inline edit flow:
   * 1. Get selection from active editor
   * 2. Prompt user for instruction
   * 3. Generate replacement via AI
   * 4. Apply to editor
   */
  async execute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showWarningMessage("DanteCode: Select code first, then press Cmd+K");
      return;
    }

    const selectedText = editor.document.getText(editor.selection);
    const language = editor.document.languageId;
    const filePath = editor.document.uri.fsPath;

    // Step 1: Get edit instruction from user
    const instruction = await vscode.window.showInputBox({
      placeHolder: "Describe what to change...",
      prompt: `Edit ${selectedText.split("\n").length} lines of ${language}`,
      validateInput: (v) => (v.trim().length < 3 ? "Describe the change (min 3 chars)" : null),
    });

    if (!instruction) return;

    // Step 2: Build context (10 lines before/after selection)
    const doc = editor.document;
    const selStart = editor.selection.start.line;
    const selEnd = editor.selection.end.line;
    const contextBefore = doc.getText(
      new vscode.Range(Math.max(0, selStart - 10), 0, selStart, 0),
    );
    const contextAfter = doc.getText(
      new vscode.Range(selEnd + 1, 0, Math.min(doc.lineCount - 1, selEnd + 10), 999),
    );

    // Step 3: Generate replacement via AI
    const replacement = await this.generateEdit(
      selectedText,
      instruction,
      language,
      filePath,
      contextBefore,
      contextAfter,
    );

    if (!replacement) return;

    // Step 4: Apply replacement
    const success = await editor.edit((editBuilder) => {
      editBuilder.replace(editor.selection, replacement);
    });

    if (success) {
      void vscode.window.showInformationMessage(`Inline edit applied: ${instruction}`);
    } else {
      void vscode.window.showErrorMessage("Failed to apply inline edit");
    }
  }

  /**
   * Generate edited code via AI model
   */
  private async generateEdit(
    selectedText: string,
    instruction: string,
    language: string,
    filePath: string,
    contextBefore: string,
    contextAfter: string,
  ): Promise<string | undefined> {
    // Build model config from current model + secrets
    const router = await this.buildRouter();
    if (!router) return undefined;

    const systemPrompt = [
      "You are a precise code editor. The user has selected code and wants you to modify it.",
      "Return ONLY the replacement code. No markdown fences, no explanations, no commentary.",
      "Preserve the exact indentation style of the original code.",
      `Language: ${language}`,
      `File: ${filePath}`,
    ].join("\n");

    const userPrompt = [
      `## Instruction\n${instruction}`,
      "",
      `## Context Before Selection`,
      contextBefore.trim() || "(start of file)",
      "",
      `## Selected Code (replace this)`,
      selectedText,
      "",
      `## Context After Selection`,
      contextAfter.trim() || "(end of file)",
      "",
      "Return ONLY the replacement code for the selected section.",
    ].join("\n");

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "DanteCode: Generating edit...",
        cancellable: true,
      },
      async (progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        try {
          const messages = [
            { role: "user" as const, content: userPrompt },
          ];

          const streamResult = await router.stream(messages, {
            system: systemPrompt,
            maxTokens: 4096,
            abortSignal: abortController.signal,
          });

          let fullText = "";
          for await (const chunk of streamResult.textStream) {
            fullText += chunk;
            progress.report({ message: `${fullText.split("\n").length} lines...` });
          }

          // Strip markdown fences if model wraps response
          return this.stripMarkdownFences(fullText.trim());
        } catch (err: unknown) {
          if (abortController.signal.aborted) {
            return undefined; // User cancelled
          }
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Inline edit failed: ${msg}`);
          return undefined;
        }
      },
    );
  }

  /**
   * Build ModelRouterImpl from current model + stored API key
   */
  private async buildRouter(): Promise<ModelRouterImpl | undefined> {
    const slashIdx = this.currentModel.indexOf("/");
    const provider = slashIdx >= 0 ? this.currentModel.substring(0, slashIdx) : "grok";
    const modelId = slashIdx >= 0 ? this.currentModel.substring(slashIdx + 1) : this.currentModel;

    // Get API key from secrets
    const secretKey = PROVIDER_SECRET_KEYS[provider];
    let apiKey: string | undefined;
    if (secretKey) {
      apiKey = await this.secrets.get(secretKey) ?? undefined;
    }

    if (provider !== "ollama" && !apiKey) {
      void vscode.window.showWarningMessage(
        `No API key for ${provider}. Open DanteCode settings to configure.`,
      );
      return undefined;
    }

    const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      apiKey,
      maxTokens: 4096,
      temperature: 0.1,
      contextWindow: 32768,
      supportsVision: false,
      supportsToolCalls: false,
    };

    const routerConfig: ModelRouterConfig = {
      default: modelConfig,
      fallback: [],
      overrides: {},
    };

    return new ModelRouterImpl(routerConfig, projectRoot, `inline-edit-${Date.now()}`);
  }

  /**
   * Strip markdown code fences from AI response
   */
  private stripMarkdownFences(text: string): string {
    // Remove opening fence: ```language\n
    let result = text.replace(/^```[\w]*\n?/, "");
    // Remove closing fence: \n```
    result = result.replace(/\n?```$/, "");
    return result;
  }
}
