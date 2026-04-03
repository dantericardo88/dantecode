// ============================================================================
// DanteCode Cmd+K Inline Edit Provider
// Cursor-style inline editing: select code → describe change → AI generates
// diff preview → user accepts or rejects
// ============================================================================

import * as vscode from "vscode";
import { ModelRouterImpl } from "@dantecode/core";
import type { ModelRouterConfig, ModelConfig } from "@dantecode/config-types";
import { DiffContentCache } from "./ui-enhancements/diff-viewer.js";

/** VSCode secret storage keys for provider API keys */
const PROVIDER_SECRET_KEYS: Record<string, string> = {
  grok: "dantecode.grokApiKey",
  anthropic: "dantecode.anthropicApiKey",
  openai: "dantecode.openaiApiKey",
  google: "dantecode.googleApiKey",
};

/** Strip markdown code fences from AI response */
export function stripMarkdownFences(text: string): string {
  let result = text.replace(/^```[\w]*\n?/, "");
  result = result.replace(/\n?```$/, "");
  return result;
}

/** Parse "provider/modelId" string into components */
export function parseModelString(model: string): { provider: string; modelId: string } {
  const slashIdx = model.indexOf("/");
  if (slashIdx >= 0) {
    return { provider: model.substring(0, slashIdx), modelId: model.substring(slashIdx + 1) };
  }
  return { provider: "grok", modelId: model };
}

/** Build the system prompt for inline editing */
export function buildEditSystemPrompt(language: string, filePath: string): string {
  return [
    "You are a precise code editor. The user has selected code and wants you to modify it.",
    "Return ONLY the replacement code. No markdown fences, no explanations, no commentary.",
    "Preserve the exact indentation style of the original code.",
    "Do not add or remove lines outside the selected region unless the instruction requires it.",
    `Language: ${language}`,
    `File: ${filePath}`,
  ].join("\n");
}

/** Build the user prompt with context for inline editing */
export function buildEditUserPrompt(
  instruction: string,
  selectedText: string,
  contextBefore: string,
  contextAfter: string,
): string {
  return [
    `## Instruction\n${instruction}`,
    "",
    "## Context Before Selection",
    contextBefore.trim() || "(start of file)",
    "",
    "## Selected Code (replace this)",
    selectedText,
    "",
    "## Context After Selection",
    contextAfter.trim() || "(end of file)",
    "",
    "Return ONLY the replacement code for the selected section. No explanation.",
  ].join("\n");
}

/**
 * Inline Edit Provider — handles Cmd+K edit flow with diff preview
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
   * 1. Get selection (or current line if no selection)
   * 2. Prompt user for instruction
   * 3. Generate replacement via AI
   * 4. Show diff preview — user accepts or rejects
   * 5. Apply if accepted
   */
  async execute(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("DanteCode: Open a file first");
      return;
    }

    // If no selection, expand to current line
    let selection = editor.selection;
    if (selection.isEmpty) {
      const line = editor.document.lineAt(selection.active.line);
      selection = new vscode.Selection(line.range.start, line.range.end);
    }

    const selectedText = editor.document.getText(selection);
    if (selectedText.trim().length === 0) {
      void vscode.window.showWarningMessage("DanteCode: Select non-empty code to edit");
      return;
    }

    const language = editor.document.languageId;
    const filePath = editor.document.uri.fsPath;
    const lineCount = selectedText.split("\n").length;

    // Step 1: Get edit instruction
    const instruction = await vscode.window.showInputBox({
      placeHolder: "Describe what to change...",
      prompt: `Edit ${lineCount} line${lineCount > 1 ? "s" : ""} of ${language}`,
      validateInput: (v) => (v.trim().length < 3 ? "Describe the change (min 3 chars)" : null),
    });

    if (!instruction) return;

    // Step 2: Gather context (10 lines before/after)
    const doc = editor.document;
    const selStart = selection.start.line;
    const selEnd = selection.end.line;
    const contextBefore = doc.getText(
      new vscode.Range(Math.max(0, selStart - 10), 0, selStart, 0),
    );
    const contextAfter = doc.getText(
      new vscode.Range(
        Math.min(doc.lineCount - 1, selEnd + 1), 0,
        Math.min(doc.lineCount - 1, selEnd + 10), 999,
      ),
    );

    // Step 3: Generate replacement
    const replacement = await this.generateEdit(
      selectedText, instruction, language, filePath, contextBefore, contextAfter,
    );
    if (!replacement) return;

    // Step 4: If replacement is identical, nothing to do
    if (replacement === selectedText) {
      void vscode.window.showInformationMessage("No changes needed — code already matches instruction");
      return;
    }

    // Step 5: Show diff preview and ask for confirmation
    const accepted = await this.showDiffPreview(selectedText, replacement, instruction, filePath);
    if (!accepted) return;

    // Step 6: Apply the edit
    const success = await editor.edit((editBuilder) => {
      editBuilder.replace(selection, replacement);
    });

    if (success) {
      void vscode.window.showInformationMessage(`Inline edit applied: ${instruction}`);
    } else {
      void vscode.window.showErrorMessage("Failed to apply inline edit");
    }
  }

  /**
   * Show a diff preview and ask the user to accept or reject.
   * Returns true if accepted.
   */
  private async showDiffPreview(
    originalText: string,
    editedText: string,
    instruction: string,
    filePath: string,
  ): Promise<boolean> {
    // Create virtual URIs for the diff viewer
    const fileName = filePath.split(/[\\/]/).pop() ?? "inline-edit";
    const timestamp = Date.now();
    const leftUri = vscode.Uri.parse(
      `dantecode-diff:/${fileName}.original.${timestamp}?content=${encodeURIComponent(originalText)}`,
    );
    const rightUri = vscode.Uri.parse(
      `dantecode-diff:/${fileName}.edited.${timestamp}?content=${encodeURIComponent(editedText)}`,
    );

    // Store content for the content provider (reuse existing dantecode-diff scheme)
    DiffContentCache.set(leftUri.toString(), originalText);
    DiffContentCache.set(rightUri.toString(), editedText);

    // Open diff editor
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `Cmd+K: ${instruction}`,
      { preview: true },
    );

    // Ask user to accept or reject
    const choice = await vscode.window.showInformationMessage(
      `Apply this edit? "${instruction}"`,
      { modal: false },
      "Accept",
      "Reject",
    );

    // Clean up cache
    DiffContentCache.clear(leftUri.toString());
    DiffContentCache.clear(rightUri.toString());

    // Close the diff editor
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    return choice === "Accept";
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
    const router = await this.buildRouter();
    if (!router) return undefined;

    const systemPrompt = buildEditSystemPrompt(language, filePath);
    const userPrompt = buildEditUserPrompt(instruction, selectedText, contextBefore, contextAfter);

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
          const messages = [{ role: "user" as const, content: userPrompt }];

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

          return stripMarkdownFences(fullText.trim());
        } catch (err: unknown) {
          if (abortController.signal.aborted) return undefined;
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
    const { provider, modelId } = parseModelString(this.currentModel);

    const secretKey = PROVIDER_SECRET_KEYS[provider];
    let apiKey: string | undefined;
    if (secretKey) {
      apiKey = await this.secrets.get(secretKey) ?? undefined;
    }

    if (provider !== "ollama" && !apiKey) {
      const action = await vscode.window.showWarningMessage(
        `Cmd+K needs an API key for ${provider}. Set one up to start editing with AI.`,
        "Setup API Keys",
      );
      if (action === "Setup API Keys") {
        void vscode.commands.executeCommand("dantecode.setupApiKeys");
      }
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
}

