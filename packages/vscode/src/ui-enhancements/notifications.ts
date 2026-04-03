// ============================================================================
// DanteCode VS Code Extension — Notification Toasts
// Non-intrusive notifications for background task completions
// ============================================================================

import * as vscode from "vscode";

/**
 * Notification severity levels.
 */
export type NotificationSeverity = "info" | "success" | "warning" | "error";

/**
 * Notification with optional actions.
 */
export interface Notification {
  message: string;
  severity: NotificationSeverity;
  actions?: NotificationAction[];
  dismissible?: boolean;
}

/**
 * Action button on notification.
 */
export interface NotificationAction {
  label: string;
  callback: () => void | Promise<void>;
}

/**
 * Notification manager for non-intrusive toasts.
 */
export class NotificationManager {
  private activeNotifications = new Map<string, vscode.StatusBarItem>();
  private notificationQueue: Array<{ id: string; notification: Notification }> = [];
  private isProcessing = false;

  /**
   * Show a notification toast.
   */
  async show(notification: Notification): Promise<void> {
    const id = `notification-${Date.now()}-${Math.random()}`;
    this.notificationQueue.push({ id, notification });

    if (!this.isProcessing) {
      await this.processQueue();
    }
  }

  /**
   * Process notification queue sequentially.
   */
  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.notificationQueue.length > 0) {
      const item = this.notificationQueue.shift();
      if (!item) break;

      await this.showNotification(item.id, item.notification);
    }

    this.isProcessing = false;
  }

  /**
   * Show individual notification using VSCode's notification API.
   */
  private async showNotification(id: string, notification: Notification): Promise<void> {
    const { message, severity, actions, dismissible = true } = notification;

    // Build action labels
    const actionLabels = actions?.map((a) => a.label) || [];
    if (dismissible) {
      actionLabels.push("Dismiss");
    }

    // Show notification based on severity
    let result: string | undefined;

    switch (severity) {
      case "success":
      case "info":
        result = await vscode.window.showInformationMessage(message, ...actionLabels);
        break;
      case "warning":
        result = await vscode.window.showWarningMessage(message, ...actionLabels);
        break;
      case "error":
        result = await vscode.window.showErrorMessage(message, ...actionLabels);
        break;
    }

    // Execute action callback if selected
    if (result && result !== "Dismiss") {
      const action = actions?.find((a) => a.label === result);
      if (action) {
        await action.callback();
      }
    }
  }

  /**
   * Show success notification.
   */
  async success(message: string, actions?: NotificationAction[]): Promise<void> {
    await this.show({ message, severity: "success", actions });
  }

  /**
   * Show info notification.
   */
  async info(message: string, actions?: NotificationAction[]): Promise<void> {
    await this.show({ message, severity: "info", actions });
  }

  /**
   * Show warning notification.
   */
  async warning(message: string, actions?: NotificationAction[]): Promise<void> {
    await this.show({ message, severity: "warning", actions });
  }

  /**
   * Show error notification.
   */
  async error(message: string, actions?: NotificationAction[]): Promise<void> {
    await this.show({ message, severity: "error", actions });
  }

  /**
   * Show background task completion notification.
   */
  async taskCompleted(taskName: string, success: boolean, details?: string): Promise<void> {
    const message = success
      ? `Background task "${taskName}" completed successfully`
      : `Background task "${taskName}" failed`;

    const fullMessage = details ? `${message}\n${details}` : message;

    const actions: NotificationAction[] = [
      {
        label: "View Details",
        callback: async () => {
          const doc = await vscode.workspace.openTextDocument({
            content: `Task: ${taskName}\nStatus: ${success ? "Success" : "Failed"}\n\n${details || "No details available"}`,
            language: "plaintext",
          });
          await vscode.window.showTextDocument(doc);
        },
      },
    ];

    await this.show({
      message: fullMessage,
      severity: success ? "success" : "error",
      actions,
    });
  }

  /**
   * Show PDSE score notification with action to view details.
   */
  async pdseScore(filePath: string, score: number, passed: boolean): Promise<void> {
    const message = passed
      ? `PDSE Check Passed: ${score}/100`
      : `PDSE Check Failed: ${score}/100`;

    const actions: NotificationAction[] = [
      {
        label: "View File",
        callback: async () => {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc);
        },
      },
    ];

    await this.show({
      message,
      severity: passed ? "success" : "warning",
      actions,
    });
  }

  /**
   * Show verification failure notification.
   */
  async verificationFailed(
    fileName: string,
    issues: string[],
    onFix?: () => void
  ): Promise<void> {
    const message = `Verification failed for ${fileName}: ${issues.length} issue(s)`;

    const actions: NotificationAction[] = [];

    if (onFix) {
      actions.push({
        label: "Fix Issues",
        callback: onFix,
      });
    }

    actions.push({
      label: "View Issues",
      callback: async () => {
        const doc = await vscode.workspace.openTextDocument({
          content: `Verification Issues for ${fileName}\n\n${issues.join("\n\n")}`,
          language: "plaintext",
        });
        await vscode.window.showTextDocument(doc);
      },
    });

    await this.show({ message, severity: "warning", actions });
  }

  /**
   * Show agent progress update notification.
   */
  async agentProgress(agentName: string, status: string, progress?: number): Promise<void> {
    const progressText = progress !== undefined ? ` (${progress}%)` : "";
    const message = `Agent "${agentName}": ${status}${progressText}`;

    // Use info for progress updates (less intrusive)
    await this.info(message);
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    for (const item of this.activeNotifications.values()) {
      item.dispose();
    }
    this.activeNotifications.clear();
  }
}

/**
 * Global notification manager instance.
 */
let globalNotificationManager: NotificationManager | undefined;

/**
 * Get or create global notification manager.
 */
export function getNotificationManager(): NotificationManager {
  if (!globalNotificationManager) {
    globalNotificationManager = new NotificationManager();
  }
  return globalNotificationManager;
}

/**
 * Register notification manager with extension.
 */
export function registerNotificationManager(context: vscode.ExtensionContext): NotificationManager {
  const manager = getNotificationManager();

  // Command to test notifications
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.testNotification", async () => {
      await manager.success("Test notification", [
        {
          label: "Action 1",
          callback: async () => {
            await vscode.window.showInformationMessage("Action 1 executed");
          },
        },
      ]);
    })
  );

  // Cleanup on extension deactivate
  context.subscriptions.push({
    dispose: () => {
      manager.dispose();
    },
  });

  return manager;
}
