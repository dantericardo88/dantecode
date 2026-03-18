import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackgroundAgentTask } from "@dantecode/config-types";

export class BackgroundTaskStore {
  private readonly tasksDir: string;

  constructor(projectRoot: string) {
    this.tasksDir = join(projectRoot, ".dantecode", "bg-tasks");
  }

  async saveTask(task: BackgroundAgentTask): Promise<void> {
    await this.ensureDir();
    await writeFile(this.getTaskPath(task.id), JSON.stringify(task, null, 2), "utf-8");
  }

  async loadTask(taskId: string): Promise<BackgroundAgentTask | null> {
    try {
      const raw = await readFile(this.getTaskPath(taskId), "utf-8");
      return JSON.parse(raw) as BackgroundAgentTask;
    } catch {
      return null;
    }
  }

  async listTasks(): Promise<BackgroundAgentTask[]> {
    try {
      await this.ensureDir();
      const entries = await readdir(this.tasksDir);
      const tasks = await Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map(async (entry) => {
            try {
              const raw = await readFile(join(this.tasksDir, entry), "utf-8");
              return JSON.parse(raw) as BackgroundAgentTask;
            } catch {
              return null;
            }
          }),
      );

      return tasks
        .filter((task): task is BackgroundAgentTask => task !== null)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  async deleteTask(taskId: string): Promise<boolean> {
    try {
      await unlink(this.getTaskPath(taskId));
      return true;
    } catch {
      return false;
    }
  }

  async cleanupExpired(maxAgeDays = 7): Promise<number> {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const tasks = await this.listTasks();
    let removed = 0;

    for (const task of tasks) {
      const updatedAt = task.completedAt ?? task.createdAt;
      const expired = now - new Date(updatedAt).getTime() > maxAgeMs;
      const terminal =
        task.status === "completed" || task.status === "failed" || task.status === "cancelled";

      if (expired && terminal) {
        if (await this.deleteTask(task.id)) {
          removed++;
        }
      }
    }

    return removed;
  }

  getTasksDir(): string {
    return this.tasksDir;
  }

  private getTaskPath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true });
  }
}
