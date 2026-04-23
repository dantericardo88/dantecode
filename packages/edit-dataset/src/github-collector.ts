// ============================================================================
// packages/edit-dataset/src/github-collector.ts
//
// Fetches commits from GitHub and filters for focused, high-quality edits.
// Uses GitHub REST API v3 via fetch. Injectable fetchFn for testability.
// ============================================================================

import type { RawCommit, RawCommitFile, FilePair } from "./types.js";

// ── Language detection ────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  cpp: "cpp", cc: "cpp", cxx: "cpp",
  c: "c", h: "c",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  php: "php",
};

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "unknown";
}

// ── Filter predicates ─────────────────────────────────────────────────────────

/** Commit quality filter — rejects noise, keeps focused feature/fix commits */
export function isQualityCommit(commit: RawCommit): boolean {
  // Reject merge commits
  if (commit.parentCount > 1) return false;
  // Reject too many files (mass refactors, format passes)
  if (commit.filesChanged > 4) return false;
  // Reject huge diffs
  if (commit.totalLines > 200) return false;
  // Reject bot authors
  if (commit.authorName.toLowerCase().includes("[bot]")) return false;
  if (commit.authorEmail.includes("noreply")) return false;
  // Reject format/style/chore commits
  const msg = commit.message.toLowerCase();
  if (msg.startsWith("chore: format") || msg.startsWith("style:") ||
      msg.startsWith("chore(format)") || msg.startsWith("fix: lint") ||
      msg.startsWith("chore: lint")) return false;
  // Reject release commits
  if (/^v?\d+\.\d+\.\d+/.test(commit.message)) return false;
  // Must have at least one source file change
  const hasSource = commit.files.some(
    (f) => detectLanguage(f.filename) !== "unknown" && f.patch !== undefined
  );
  return hasSource;
}

// ── GitHubCommitCollector ─────────────────────────────────────────────────────

export interface CollectorOptions {
  token: string;
  rateLimitMs?: number;
  /** Injectable fetch for testing */
  fetchFn?: typeof fetch;
}

export class GitHubCommitCollector {
  private readonly _token: string;
  private readonly _rateLimitMs: number;
  private readonly _fetch: typeof fetch;

  constructor(options: CollectorOptions) {
    this._token = options.token;
    this._rateLimitMs = options.rateLimitMs ?? 100;
    this._fetch = options.fetchFn ?? globalThis.fetch;
  }

  /** Fetch up to `maxCommits` commits from a GitHub repo */
  async collectFromRepo(
    owner: string,
    repo: string,
    maxCommits = 500,
  ): Promise<RawCommit[]> {
    const commits: RawCommit[] = [];
    let page = 1;
    const perPage = Math.min(maxCommits, 100);

    while (commits.length < maxCommits) {
      const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`;
      const res = await this._fetchJson<CommitListItem[]>(url);
      if (!res || res.length === 0) break;

      for (const item of res) {
        if (commits.length >= maxCommits) break;
        const detail = await this._fetchCommitDetail(owner, repo, item.sha);
        if (detail) commits.push(detail);
        await this._sleep(this._rateLimitMs);
      }
      page++;
      if (res.length < perPage) break;
    }

    return commits;
  }

  /** Filter commits for training quality */
  filterFocusedCommits(commits: RawCommit[]): RawCommit[] {
    return commits.filter(isQualityCommit);
  }

  /** Fetch before/after file content for a commit's changed files */
  async fetchFilePairs(commit: RawCommit, owner: string, repo: string): Promise<FilePair[]> {
    const pairs: FilePair[] = [];

    for (const file of commit.files) {
      if (file.status === "removed" || !file.patch) continue;
      if (detectLanguage(file.filename) === "unknown") continue;

      try {
        // Fetch file content at parent SHA (before)
        const parentSha = commit.sha + "^";
        const beforeContent = await this._fetchFileContent(owner, repo, file.filename, parentSha);
        // Fetch file content at current SHA (after)
        const afterContent = await this._fetchFileContent(owner, repo, file.filename, commit.sha);

        if (beforeContent !== null && afterContent !== null) {
          pairs.push({
            filename: file.filename,
            language: detectLanguage(file.filename),
            beforeContent,
            afterContent,
            patch: file.patch,
          });
        }
        await this._sleep(this._rateLimitMs);
      } catch {
        // Skip files we can't fetch
      }
    }

    return pairs;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _fetchCommitDetail(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<RawCommit | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
    const data = await this._fetchJson<CommitDetailResponse>(url);
    if (!data) return null;

    const files: RawCommitFile[] = (data.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status as RawCommitFile["status"],
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch,
      language: detectLanguage(f.filename),
    }));

    const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

    return {
      sha: data.sha,
      message: data.commit?.message?.split("\n")[0] ?? "",
      authorName: data.commit?.author?.name ?? "",
      authorEmail: data.commit?.author?.email ?? "",
      parentCount: (data.parents ?? []).length,
      filesChanged: files.length,
      totalLines,
      files,
    };
  }

  private async _fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    // Use the contents API with raw media type
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    const res = await this._fetch(url, {
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    return res.text();
  }

  private async _fetchJson<T>(url: string): Promise<T | null> {
    const res = await this._fetch(url, {
      headers: {
        Authorization: `Bearer ${this._token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ── GitHub API shapes ─────────────────────────────────────────────────────────

interface CommitListItem {
  sha: string;
}

interface CommitDetailResponse {
  sha: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string };
  };
  parents?: Array<{ sha: string }>;
  files?: Array<{
    filename: string;
    status: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }>;
}
