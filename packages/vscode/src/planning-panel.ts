// ============================================================================
// DanteCode VS Code Extension — Planning Panel Provider
// Visual UI for /plan workflow with approve/reject buttons and step tracking.
// ============================================================================

import * as vscode from "vscode";
import {
  PlanStore,
  PlanExecutor,
  renderPlanSummary,
  analyzeComplexity,
} from "@dantecode/core";
import type {
  StoredPlan,
  PlanExecutionResult,
  PlanStep,
  ExecutionPlan,
  StepExecutionResult,
} from "@dantecode/core";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebviewInboundMessage {
  type:
    | "ready"
    | "plan_generate"
    | "plan_show"
    | "plan_approve"
    | "plan_reject"
    | "plan_list"
    | "plan_status"
    | "plan_load";
  payload: Record<string, unknown>;
}

interface WebviewOutboundMessage {
  type:
    | "plan_data"
    | "plan_list_data"
    | "plan_status_data"
    | "plan_progress"
    | "plan_step_start"
    | "plan_step_complete"
    | "plan_approved"
    | "plan_rejected"
    | "error";
  payload: Record<string, unknown>;
}

// interface PlanProgressPayload {
//   stepId: string;
//   stepIndex: number;
//   status: "pending" | "in_progress" | "completed" | "failed";
//   description: string;
//   output?: string;
//   error?: string;
// }

// ─── Planning Panel Provider ──────────────────────────────────────────────────

export class PlanningPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.planningView";

  private view: vscode.WebviewView | undefined;
  private currentPlan: ExecutionPlan | null = null;
  private currentPlanId: string | null = null;
  private planApproved = false;
  private planMode = false;
  private executor: PlanExecutor | null = null;
  private fileWatchers: vscode.FileSystemWatcher[] = [];
  private executionInProgress = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onPlanApproved?: (plan: ExecutionPlan) => Promise<void>,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewInboundMessage) => {
      await this.handleMessage(message);
    });

    this.startFileWatchers();

    webviewView.onDidDispose(() => {
      this.disposeFileWatchers();
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Generate a new plan from a goal string. */
  async generatePlan(goal: string): Promise<void> {
    if (this.planMode && this.currentPlan) {
      this.postMessage({
        type: "error",
        payload: {
          message:
            "A plan is already active. Use /plan show, /plan approve, or /plan reject first.",
        },
      });
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      this.postMessage({
        type: "error",
        payload: { message: "No workspace folder open." },
      });
      return;
    }

    try {
      const complexity = analyzeComplexity(goal);
      const repoContext = await this.buildRepoContext(goal, projectRoot);
      const plan = this.buildRepoAwarePlan(goal, complexity, repoContext);

      // Store plan in memory
      this.planMode = true;
      this.currentPlan = plan;
      this.planApproved = false;

      // Save to disk
      const store = new PlanStore(projectRoot);
      const planId = PlanStore.generateId(goal);
      this.currentPlanId = planId;
      const storedPlan: StoredPlan = {
        plan,
        id: planId,
        status: "draft",
        createdAt: new Date().toISOString(),
      };
      await store.save(storedPlan);

      // Send to webview
      this.postMessage({
        type: "plan_data",
        payload: {
          plan,
          planId,
          status: "draft",
          canApprove: true,
          canReject: true,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({
        type: "error",
        payload: { message: `Failed to generate plan: ${message}` },
      });
    }
  }

  /** Show the current plan. */
  showPlan(): void {
    if (!this.currentPlan) {
      this.postMessage({
        type: "error",
        payload: { message: "No active plan. Use /plan <goal> to generate one." },
      });
      return;
    }

    this.postMessage({
      type: "plan_data",
      payload: {
        plan: this.currentPlan,
        planId: this.currentPlanId,
        status: this.planApproved ? "approved" : "draft",
        canApprove: !this.planApproved && !this.executionInProgress,
        canReject: !this.executionInProgress,
      },
    });
  }

  /** Approve the current plan and start execution. */
  async approvePlan(): Promise<void> {
    if (!this.currentPlan) {
      this.postMessage({
        type: "error",
        payload: { message: "No active plan to approve. Use /plan <goal> first." },
      });
      return;
    }

    if (this.planApproved) {
      this.postMessage({
        type: "error",
        payload: { message: "Plan is already approved. Execution is in progress." },
      });
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return;
    }

    this.planApproved = true;
    this.planMode = false;

    // Update status on disk
    if (this.currentPlanId) {
      const store = new PlanStore(projectRoot);
      await store.updateStatus(this.currentPlanId, "approved");
    }

    this.postMessage({
      type: "plan_approved",
      payload: { planId: this.currentPlanId },
    });

    // Execute plan
    await this.executePlan(this.currentPlan, projectRoot);
  }

  /** Reject the current plan. */
  async rejectPlan(): Promise<void> {
    if (!this.currentPlan) {
      this.postMessage({
        type: "error",
        payload: { message: "No active plan to reject." },
      });
      return;
    }

    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return;
    }

    // Update status on disk
    if (this.currentPlanId) {
      const store = new PlanStore(projectRoot);
      await store.updateStatus(this.currentPlanId, "rejected");
    }

    this.planMode = false;
    this.currentPlan = null;
    this.planApproved = false;
    this.currentPlanId = null;

    this.postMessage({
      type: "plan_rejected",
      payload: {},
    });
  }

  /** List saved plans. */
  async listPlans(): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      this.postMessage({
        type: "error",
        payload: { message: "No workspace folder open." },
      });
      return;
    }

    try {
      const store = new PlanStore(projectRoot);
      const plans = await store.list({ limit: 20 });

      this.postMessage({
        type: "plan_list_data",
        payload: {
          plans: plans.map((p) => ({
            id: p.id,
            goal: p.plan.goal,
            status: p.status,
            createdAt: p.createdAt,
            stepCount: p.plan.steps.length,
            complexity: p.plan.estimatedComplexity,
            summary: renderPlanSummary(p.plan),
          })),
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({
        type: "error",
        payload: { message: `Failed to list plans: ${message}` },
      });
    }
  }

  /** Show current plan status. */
  showStatus(): void {
    this.postMessage({
      type: "plan_status_data",
      payload: {
        planMode: this.planMode,
        planApproved: this.planApproved,
        currentPlanId: this.currentPlanId,
        executionInProgress: this.executionInProgress,
        summary: this.currentPlan ? renderPlanSummary(this.currentPlan) : null,
      },
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async handleMessage(message: WebviewInboundMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        if (this.currentPlan) {
          this.showPlan();
        } else {
          await this.listPlans();
        }
        break;
      case "plan_generate":
        await this.generatePlan(String(message.payload["goal"] ?? ""));
        break;
      case "plan_show":
        this.showPlan();
        break;
      case "plan_approve":
        await this.approvePlan();
        break;
      case "plan_reject":
        await this.rejectPlan();
        break;
      case "plan_list":
        await this.listPlans();
        break;
      case "plan_status":
        this.showStatus();
        break;
      case "plan_load":
        await this.loadPlan(String(message.payload["planId"] ?? ""));
        break;
    }
  }

  private async loadPlan(planId: string): Promise<void> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return;
    }

    try {
      const store = new PlanStore(projectRoot);
      const stored = await store.load(planId);
      if (!stored) {
        this.postMessage({
          type: "error",
          payload: { message: `Plan ${planId} not found.` },
        });
        return;
      }

      this.currentPlan = stored.plan;
      this.currentPlanId = stored.id;
      this.planApproved = stored.status === "approved" || stored.status === "executing";
      this.planMode = stored.status === "draft";

      this.postMessage({
        type: "plan_data",
        payload: {
          plan: stored.plan,
          planId: stored.id,
          status: stored.status,
          canApprove: stored.status === "draft" && !this.executionInProgress,
          canReject: !this.executionInProgress,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({
        type: "error",
        payload: { message: `Failed to load plan: ${message}` },
      });
    }
  }

  private async executePlan(plan: ExecutionPlan, projectRoot: string): Promise<void> {
    this.executionInProgress = true;

    this.executor = new PlanExecutor({
      executeStep: async (step: PlanStep): Promise<StepExecutionResult> => {
        const startMs = Date.now();

        // Callback to parent extension to execute this step via agent
        if (this.onPlanApproved) {
          // NOTE: This is a simplified execution - real implementation would
          // need to wire this to the chat sidebar agent loop
          await this.onPlanApproved(plan);
        }

        return {
          stepId: step.id,
          success: true,
          output: `Step queued: ${step.description}`,
          durationMs: Date.now() - startMs,
        };
      },
      onStepStart: (step: PlanStep) => {
        step.status = "in_progress";
        const stepIndex = plan.steps.indexOf(step);
        this.postMessage({
          type: "plan_step_start",
          payload: {
            stepId: step.id,
            stepIndex,
            status: "in_progress",
            description: step.description,
          },
        });
      },
      onStepComplete: (step: PlanStep, result: StepExecutionResult) => {
        step.status = result.success ? "completed" : "failed";
        const stepIndex = plan.steps.indexOf(step);
        this.postMessage({
          type: "plan_step_complete",
          payload: {
            stepId: step.id,
            stepIndex,
            status: step.status,
            description: step.description,
            output: result.output,
            error: result.error,
          },
        });

        // Persist progress
        if (this.currentPlanId) {
          const store = new PlanStore(projectRoot);
          store
            .save({
              plan: this.currentPlan!,
              id: this.currentPlanId,
              status: "executing",
              createdAt: new Date().toISOString(),
            })
            .catch(() => {
              /* non-fatal */
            });
        }
      },
    });

    try {
      const result: PlanExecutionResult = await this.executor.execute(plan);
      this.executionInProgress = false;

      if (this.currentPlanId) {
        const store = new PlanStore(projectRoot);
        const finalStatus = result.allPassed ? "completed" : "failed";
        await store.updateStatus(this.currentPlanId, finalStatus);
      }

      this.postMessage({
        type: "plan_progress",
        payload: {
          completed: true,
          allPassed: result.allPassed,
          totalDurationMs: result.totalDurationMs,
        },
      });
    } catch (error: unknown) {
      this.executionInProgress = false;
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({
        type: "error",
        payload: { message: `Plan execution failed: ${message}` },
      });
    }
  }

  private async buildRepoContext(
    _goal: string,
    _projectRoot: string,
  ): Promise<{ relevantFiles: string[]; verificationCommands: string[] }> {
    // Simplified version - in real implementation, this would scan repo
    // For now, return empty context
    return {
      relevantFiles: [],
      verificationCommands: ["npm test", "npm run typecheck"],
    };
  }

  private buildRepoAwarePlan(
    goal: string,
    complexity: number,
    repoContext: { relevantFiles: string[]; verificationCommands: string[] },
  ): ExecutionPlan {
    const steps: PlanStep[] = [
      {
        id: "step-1",
        description: `Gather read-only context for "${goal}" before editing.`,
        files: repoContext.relevantFiles.slice(0, 6),
        status: "pending",
      },
      {
        id: "step-2",
        description: `Implement the required code changes for "${goal}".`,
        files: repoContext.relevantFiles.slice(0, 6),
        dependencies: ["step-1"],
        status: "pending",
      },
      {
        id: "step-3",
        description: `Verify the changed areas and supporting proof for "${goal}".`,
        files: repoContext.relevantFiles.slice(0, 4),
        dependencies: ["step-2"],
        verifyCommand: repoContext.verificationCommands[0] ?? "npm test",
        status: "pending",
      },
    ];

    return {
      goal,
      steps,
      createdAt: new Date().toISOString(),
      estimatedComplexity: complexity,
    };
  }

  private postMessage(message: WebviewOutboundMessage): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  private getProjectRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private startFileWatchers(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }

    const pattern = new vscode.RelativePattern(folder, ".dantecode/plans/*.json");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => void this.listPlans());
    watcher.onDidCreate(() => void this.listPlans());
    watcher.onDidDelete(() => void this.listPlans());
    this.fileWatchers.push(watcher);
  }

  private disposeFileWatchers(): void {
    for (const watcher of this.fileWatchers) {
      watcher.dispose();
    }
    this.fileWatchers = [];
  }

  private getHtmlForWebview(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Planning Mode</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.5;
    }

    .container {
      max-width: 800px;
    }

    h1, h2, h3 {
      margin-bottom: 12px;
      font-weight: 600;
    }

    h1 {
      font-size: 1.4em;
      color: var(--vscode-foreground);
    }

    h2 {
      font-size: 1.2em;
      margin-top: 24px;
    }

    h3 {
      font-size: 1.1em;
      margin-top: 16px;
    }

    .plan-header {
      padding: 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 4px solid var(--vscode-textLink-foreground);
      margin-bottom: 24px;
      border-radius: 4px;
    }

    .plan-meta {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }

    .complexity-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-weight: 600;
      font-size: 0.85em;
    }

    .complexity-low {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
    }

    .complexity-medium {
      background: var(--vscode-editorWarning-foreground);
      color: var(--vscode-editor-background);
    }

    .complexity-high {
      background: var(--vscode-editorError-foreground);
      color: var(--vscode-editor-background);
    }

    .step {
      padding: 12px;
      margin-bottom: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      border-left: 3px solid var(--vscode-descriptionForeground);
    }

    .step.pending {
      border-left-color: var(--vscode-descriptionForeground);
    }

    .step.in_progress {
      border-left-color: var(--vscode-editorWarning-foreground);
      background: var(--vscode-inputValidation-warningBackground);
    }

    .step.completed {
      border-left-color: var(--vscode-testing-iconPassed);
    }

    .step.failed {
      border-left-color: var(--vscode-editorError-foreground);
      background: var(--vscode-inputValidation-errorBackground);
    }

    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    .step-icon {
      font-family: monospace;
      font-weight: bold;
    }

    .step-details {
      margin-top: 8px;
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }

    .step-files {
      margin-top: 4px;
    }

    .step-verify {
      margin-top: 4px;
      font-family: var(--vscode-editor-font-family);
    }

    .step-error {
      margin-top: 8px;
      padding: 8px;
      background: var(--vscode-inputValidation-errorBackground);
      border-radius: 3px;
      color: var(--vscode-errorForeground);
    }

    .actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }

    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 0.95em;
      cursor: pointer;
      font-weight: 500;
      transition: opacity 0.2s;
    }

    button:hover:not(:disabled) {
      opacity: 0.9;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-approve {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-reject {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-neutral {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .plan-list {
      margin-top: 16px;
    }

    .plan-item {
      padding: 12px;
      margin-bottom: 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .plan-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .plan-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .plan-item-goal {
      font-weight: 500;
    }

    .status-badge {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.8em;
      font-weight: 600;
    }

    .status-draft {
      background: var(--vscode-descriptionForeground);
      color: var(--vscode-editor-background);
    }

    .status-approved {
      background: var(--vscode-textLink-foreground);
      color: var(--vscode-editor-background);
    }

    .status-completed {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
    }

    .status-failed {
      background: var(--vscode-editorError-foreground);
      color: var(--vscode-editor-background);
    }

    .status-rejected {
      background: var(--vscode-descriptionForeground);
      color: var(--vscode-editor-background);
    }

    .plan-item-meta {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    .error-message {
      padding: 12px;
      margin-bottom: 16px;
      background: var(--vscode-inputValidation-errorBackground);
      border-left: 4px solid var(--vscode-editorError-foreground);
      border-radius: 4px;
      color: var(--vscode-errorForeground);
    }

    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state h2 {
      margin-top: 16px;
    }

    .progress {
      margin-top: 16px;
      padding: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
    }

    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--vscode-descriptionForeground);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }

    .progress-bar-fill {
      height: 100%;
      background: var(--vscode-testing-iconPassed);
      transition: width 0.3s;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="error-container"></div>
    <div id="plan-container"></div>
    <div id="list-container"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentPlan = null;
    let currentStatus = 'draft';

    // Send ready message
    vscode.postMessage({ type: 'ready', payload: {} });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'plan_data':
          showPlan(message.payload);
          break;
        case 'plan_list_data':
          showPlanList(message.payload.plans);
          break;
        case 'plan_status_data':
          showStatus(message.payload);
          break;
        case 'plan_step_start':
          updateStepStatus(message.payload);
          break;
        case 'plan_step_complete':
          updateStepStatus(message.payload);
          break;
        case 'plan_approved':
          showMessage('Plan approved! Execution started.');
          break;
        case 'plan_rejected':
          showMessage('Plan rejected.');
          document.getElementById('plan-container').innerHTML = '';
          vscode.postMessage({ type: 'plan_list', payload: {} });
          break;
        case 'error':
          showError(message.payload.message);
          break;
        case 'plan_progress':
          if (message.payload.completed) {
            const status = message.payload.allPassed ? 'completed' : 'failed';
            showMessage(\`Plan execution \${status}. Duration: \${(message.payload.totalDurationMs / 1000).toFixed(1)}s\`);
          }
          break;
      }
    });

    function showPlan(data) {
      currentPlan = data.plan;
      currentStatus = data.status;

      const container = document.getElementById('plan-container');
      document.getElementById('list-container').innerHTML = '';

      const complexityClass =
        data.plan.estimatedComplexity >= 0.8 ? 'complexity-high' :
        data.plan.estimatedComplexity >= 0.5 ? 'complexity-medium' :
        'complexity-low';

      const complexityLabel =
        data.plan.estimatedComplexity >= 0.8 ? 'CRITICAL' :
        data.plan.estimatedComplexity >= 0.5 ? 'HIGH' :
        data.plan.estimatedComplexity >= 0.3 ? 'MED' :
        'LOW';

      let html = \`
        <div class="plan-header">
          <h1>\${escapeHtml(data.plan.goal)}</h1>
          <div class="plan-meta">
            <span>Steps: \${data.plan.steps.length}</span>
            <span>Complexity: <span class="complexity-badge \${complexityClass}">\${complexityLabel}</span> (\${data.plan.estimatedComplexity.toFixed(2)})</span>
            <span>Status: <span class="status-badge status-\${data.status}">\${data.status.toUpperCase()}</span></span>
          </div>
        </div>

        <h2>Execution Steps</h2>
      \`;

      data.plan.steps.forEach((step, index) => {
        const statusIcon =
          step.status === 'completed' ? '[✓]' :
          step.status === 'in_progress' ? '[▸]' :
          step.status === 'failed' ? '[✗]' :
          '[ ]';

        html += \`
          <div class="step \${step.status}" id="step-\${step.id}">
            <div class="step-header">
              <span class="step-icon">\${statusIcon}</span>
              <span><strong>\${index + 1}.</strong> \${escapeHtml(step.description)}</span>
            </div>
            <div class="step-details">
              \${step.files.length > 0 ? \`<div class="step-files">Files: \${step.files.join(', ')}</div>\` : ''}
              \${step.dependencies?.length > 0 ? \`<div>Depends: \${step.dependencies.join(', ')}</div>\` : ''}
              \${step.verifyCommand ? \`<div class="step-verify">Verify: \${escapeHtml(step.verifyCommand)}</div>\` : ''}
              \${step.error ? \`<div class="step-error">\${escapeHtml(step.error)}</div>\` : ''}
            </div>
          </div>
        \`;
      });

      html += '<div class="actions">';
      if (data.canApprove) {
        html += '<button class="btn-approve" onclick="approvePlan()">Approve & Execute</button>';
      }
      if (data.canReject) {
        html += '<button class="btn-reject" onclick="rejectPlan()">Reject</button>';
      }
      html += '<button class="btn-neutral" onclick="showList()">Back to List</button>';
      html += '</div>';

      container.innerHTML = html;
    }

    function showPlanList(plans) {
      const container = document.getElementById('list-container');
      document.getElementById('plan-container').innerHTML = '';

      if (plans.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <h2>No Plans Yet</h2>
            <p>Use <code>/plan &lt;goal&gt;</code> in chat to generate a plan.</p>
          </div>
        \`;
        return;
      }

      let html = '<h1>Saved Plans</h1><div class="plan-list">';

      plans.forEach(plan => {
        html += \`
          <div class="plan-item" onclick="loadPlan('\${plan.id}')">
            <div class="plan-item-header">
              <div class="plan-item-goal">\${escapeHtml(plan.goal)}</div>
              <span class="status-badge status-\${plan.status}">\${plan.status.toUpperCase()}</span>
            </div>
            <div class="plan-item-meta">
              \${plan.stepCount} steps | Complexity: \${plan.complexity.toFixed(2)} |
              \${new Date(plan.createdAt).toLocaleString()}
            </div>
          </div>
        \`;
      });

      html += '</div>';
      container.innerHTML = html;
    }

    function showStatus(data) {
      const container = document.getElementById('plan-container');
      container.innerHTML = \`
        <h1>Plan Mode Status</h1>
        <div class="plan-header">
          <div class="plan-meta">
            <span>Mode: \${data.planMode ? 'Active' : 'Inactive'}</span>
            <span>Approved: \${data.planApproved ? 'Yes' : 'No'}</span>
            <span>Execution: \${data.executionInProgress ? 'In Progress' : 'Idle'}</span>
          </div>
          \${data.summary ? \`<p style="margin-top: 12px;">\${escapeHtml(data.summary)}</p>\` : ''}
        </div>
      \`;
    }

    function updateStepStatus(data) {
      const stepEl = document.getElementById(\`step-\${data.stepId}\`);
      if (!stepEl) return;

      stepEl.className = \`step \${data.status}\`;

      const icon =
        data.status === 'completed' ? '[✓]' :
        data.status === 'in_progress' ? '[▸]' :
        data.status === 'failed' ? '[✗]' :
        '[ ]';

      const iconEl = stepEl.querySelector('.step-icon');
      if (iconEl) iconEl.textContent = icon;

      if (data.error) {
        const detailsEl = stepEl.querySelector('.step-details');
        if (detailsEl) {
          detailsEl.innerHTML += \`<div class="step-error">\${escapeHtml(data.error)}</div>\`;
        }
      }
    }

    function approvePlan() {
      vscode.postMessage({ type: 'plan_approve', payload: {} });
    }

    function rejectPlan() {
      if (confirm('Are you sure you want to reject this plan?')) {
        vscode.postMessage({ type: 'plan_reject', payload: {} });
      }
    }

    function loadPlan(planId) {
      vscode.postMessage({ type: 'plan_load', payload: { planId } });
    }

    function showList() {
      vscode.postMessage({ type: 'plan_list', payload: {} });
    }

    function showError(message) {
      const container = document.getElementById('error-container');
      container.innerHTML = \`<div class="error-message">\${escapeHtml(message)}</div>\`;
      setTimeout(() => {
        container.innerHTML = '';
      }, 5000);
    }

    function showMessage(message) {
      // Reuse error container for success messages
      const container = document.getElementById('error-container');
      container.innerHTML = \`<div class="plan-header">\${escapeHtml(message)}</div>\`;
      setTimeout(() => {
        container.innerHTML = '';
      }, 3000);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
