import { exec as execCallback } from "node:child_process";
import {
  mkdir as mkdirFs,
  readFile as readFileFs,
  writeFile as writeFileFs,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execAsync = promisify(execCallback);

export interface CheckpointFileSnapshot {
  filePath: string;
  content: string;
}

export interface CheckpointRecord {
  id: string;
  createdAt: string;
  label: string;
  sessionMessageIndex?: number;
  strategy: "git_stash" | "snapshot";
  stashLabel?: string;
  fileSnapshots?: CheckpointFileSnapshot[];
}

interface CheckpointManagerOptions {
  execCommand?: (command: string, cwd: string) => Promise<string>;
  writeFile?: (filePath: string, content: string, encoding: BufferEncoding) => Promise<void>;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  mkdir?: (dirPath: string, options: { recursive: boolean }) => Promise<string | undefined>;
}

interface CreateCheckpointOptions {
  label?: string;
  sessionMessageIndex?: number;
  fileSnapshots?: CheckpointFileSnapshot[];
}

export interface CheckpointPersistenceFile {
  version: 1;
  checkpoints: CheckpointRecord[];
}

export class CheckpointManager {
  private readonly projectRoot: string;
  private readonly execCommand: (command: string, cwd: string) => Promise<string>;
  private readonly writeFile: (
    filePath: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;
  private readonly readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  private readonly mkdir: (
    dirPath: string,
    options: { recursive: boolean },
  ) => Promise<string | undefined>;
  private readonly checkpoints: CheckpointRecord[] = [];

  constructor(projectRoot: string, options: CheckpointManagerOptions = {}) {
    this.projectRoot = projectRoot;
    this.execCommand = options.execCommand ?? defaultExecCommand;
    this.writeFile = options.writeFile ?? writeFileFs;
    this.readFile = options.readFile ?? ((p, e) => readFileFs(p, e) as Promise<string>);
    this.mkdir = options.mkdir ?? mkdirFs;
  }

  async createCheckpoint(options: CreateCheckpointOptions = {}): Promise<CheckpointRecord> {
    const id = randomUUID().slice(0, 8);
    const label = options.label ?? `checkpoint-${id}`;
    const baseRecord = {
      id,
      createdAt: new Date().toISOString(),
      label,
      ...(options.sessionMessageIndex !== undefined
        ? { sessionMessageIndex: options.sessionMessageIndex }
        : {}),
    };

    // CRITICAL: when fileSnapshots are provided (e.g., agent-edit checkpoints
    // tracking the OLD content of a single file), prefer the snapshot strategy.
    // The git_stash strategy uses `git stash push -u` which captures AND REMOVES
    // working-tree changes — including the agent's just-written file, which then
    // survives only inside the stash. That manifests to the user as "files
    // appear briefly then vanish" during /ascend cycles.
    //
    // Use git stash only when no snapshots are provided (manual full-state
    // checkpoints from the user, where capturing everything is intended).
    if (options.fileSnapshots && options.fileSnapshots.length > 0) {
      const checkpoint: CheckpointRecord = {
        ...baseRecord,
        strategy: "snapshot",
        fileSnapshots: [...options.fileSnapshots],
      };
      this.checkpoints.unshift(checkpoint);
      return checkpoint;
    }

    if (await this.canUseGitStash()) {
      const stashLabel = `dantecode-checkpoint-${id}-${label}`;
      await this.execCommand(`git stash push -u -m "${stashLabel}"`, this.projectRoot);

      const checkpoint: CheckpointRecord = {
        ...baseRecord,
        strategy: "git_stash",
        stashLabel,
      };
      this.checkpoints.unshift(checkpoint);
      return checkpoint;
    }

    throw new Error("Checkpoint requires either fileSnapshots or git availability.");
  }

  listCheckpoints(): CheckpointRecord[] {
    return [...this.checkpoints];
  }

  async rewindCheckpoint(id: string): Promise<CheckpointRecord> {
    const checkpoint = this.checkpoints.find((entry) => entry.id === id);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`);
    }

    if (checkpoint.strategy === "git_stash") {
      if (!checkpoint.stashLabel) {
        throw new Error(`Checkpoint ${id} is missing stash metadata.`);
      }
      const stashLabel = checkpoint.stashLabel;

      const stashList = await this.execCommand(
        'git stash list --format="%gd %s"',
        this.projectRoot,
      );
      const matchingLine = stashList
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.includes(stashLabel));

      if (!matchingLine) {
        throw new Error(`Could not find stash entry for checkpoint ${id}.`);
      }

      const stashRef = matchingLine.split(" ")[0];
      await this.execCommand(`git stash apply --index ${stashRef}`, this.projectRoot);
      return checkpoint;
    }

    for (const snapshot of checkpoint.fileSnapshots ?? []) {
      await this.writeFile(snapshot.filePath, snapshot.content, "utf-8");
    }

    return checkpoint;
  }

  private get persistencePath(): string {
    return join(this.projectRoot, ".dantecode", "checkpoints.json");
  }

  async saveCheckpointsToFile(): Promise<void> {
    const filePath = this.persistencePath;
    await this.mkdir(dirname(filePath), { recursive: true });
    const data: CheckpointPersistenceFile = {
      version: 1,
      checkpoints: this.checkpoints,
    };
    await this.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async loadCheckpointsFromFile(): Promise<number> {
    try {
      const raw = await this.readFile(this.persistencePath, "utf-8");
      const data = JSON.parse(raw) as CheckpointPersistenceFile;
      if (data.version !== 1 || !Array.isArray(data.checkpoints)) {
        return 0;
      }
      this.checkpoints.length = 0;
      for (const record of data.checkpoints) {
        this.checkpoints.push(record);
      }
      return this.checkpoints.length;
    } catch {
      return 0;
    }
  }

  async generateDiffPreview(id: string): Promise<string> {
    const checkpoint = this.checkpoints.find((entry) => entry.id === id);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`);
    }

    if (checkpoint.strategy === "git_stash" && checkpoint.stashLabel) {
      try {
        const stashList = await this.execCommand(
          'git stash list --format="%gd %s"',
          this.projectRoot,
        );
        const matchingLine = stashList
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.includes(checkpoint.stashLabel!));

        if (!matchingLine) {
          return `# Checkpoint ${id} (${checkpoint.label})\n# Stash entry no longer available.`;
        }

        const stashRef = matchingLine.split(" ")[0];
        const diff = await this.execCommand(`git stash show -p ${stashRef}`, this.projectRoot);
        return `# Checkpoint ${id} (${checkpoint.label})\n${diff}`;
      } catch {
        return `# Checkpoint ${id} (${checkpoint.label})\n# Unable to generate git diff.`;
      }
    }

    if (checkpoint.strategy === "snapshot" && checkpoint.fileSnapshots?.length) {
      const lines = [`# Checkpoint ${id} (${checkpoint.label})`];
      for (const snap of checkpoint.fileSnapshots) {
        lines.push(`--- a/${snap.filePath}`);
        lines.push(`+++ /dev/null`);
        for (const line of snap.content.split("\n")) {
          lines.push(`-${line}`);
        }
      }
      return lines.join("\n");
    }

    return `# Checkpoint ${id} (${checkpoint.label})\n# No diff data available.`;
  }

  private async canUseGitStash(): Promise<boolean> {
    try {
      const result = await this.execCommand(
        "git rev-parse --is-inside-work-tree",
        this.projectRoot,
      );
      return result.trim() === "true";
    } catch {
      return false;
    }
  }
}

async function defaultExecCommand(command: string, cwd: string): Promise<string> {
  const result = await execAsync(command, { cwd });
  return result.stdout.trim();
}
