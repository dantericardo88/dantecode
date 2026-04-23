// packages/core/src/requirements-interview.ts
// Requirements elicitation interview loop — deepens dim 20 (spec gathering: 7→9).
//
// Harvested from: GPT-Pilot interview loop (gpt_pilot/utils/questionary.py),
//                 Devin's project onboarding Q&A, Continue.dev context provider chain.
//
// Provides:
//   - Structured Q&A loop with question taxonomy (yes/no, freeform, choice, numeric)
//   - RequirementsDocument: typed summary of elicited specs
//   - InterviewSession: step-by-step state machine with history and completion
//   - QuestionBank: pre-built question templates for common project types
//   - Answer validation + follow-up branching
//   - Format for prompt injection

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuestionKind =
  | "yes_no"       // Boolean question
  | "freeform"     // Open text
  | "choice"       // Select from fixed options
  | "numeric"      // Numeric range
  | "multi";       // Select multiple from options

export type ProjectKind =
  | "web-app"
  | "cli-tool"
  | "library"
  | "api-server"
  | "mobile-app"
  | "data-pipeline"
  | "unknown";

export interface InterviewQuestion {
  id: string;
  kind: QuestionKind;
  text: string;
  /** For choice / multi questions */
  options?: string[];
  /** If yes/no: follow-up question ID to ask if answer is "yes" */
  ifYes?: string;
  /** If yes/no: follow-up question ID to ask if answer is "no" */
  ifNo?: string;
  /** For numeric: min and max */
  range?: [number, number];
  /** Whether this question can be skipped */
  optional?: boolean;
  /** Category label for grouping in the final document */
  category: string;
}

export interface InterviewAnswer {
  questionId: string;
  value: string | string[] | number | boolean;
  /** ISO timestamp */
  answeredAt: string;
  /** Whether user explicitly skipped */
  skipped: boolean;
}

export interface RequirementsDocument {
  projectName: string;
  projectKind: ProjectKind;
  description: string;
  /** Key functional requirements */
  functionalRequirements: string[];
  /** Constraints: tech stack, budget, timeline, etc. */
  constraints: string[];
  /** Non-functional requirements */
  qualityRequirements: string[];
  /** Answers grouped by category */
  categories: Record<string, InterviewAnswer[]>;
  /** Raw Q&A pairs for full context */
  rawAnswers: InterviewAnswer[];
  completedAt: string;
}

export type InterviewStatus =
  | "not-started"
  | "in-progress"
  | "complete"
  | "abandoned";

// ─── Answer Validation ────────────────────────────────────────────────────────

export function validateAnswer(question: InterviewQuestion, raw: string): {
  valid: boolean;
  value?: InterviewAnswer["value"];
  error?: string;
} {
  switch (question.kind) {
    case "yes_no": {
      const lower = raw.trim().toLowerCase();
      if (["yes", "y", "true", "1"].includes(lower)) return { valid: true, value: true };
      if (["no", "n", "false", "0"].includes(lower)) return { valid: true, value: false };
      return { valid: false, error: 'Please answer "yes" or "no".' };
    }
    case "freeform": {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { valid: false, error: "Answer cannot be empty." };
      return { valid: true, value: trimmed };
    }
    case "choice": {
      const options = question.options ?? [];
      const match = options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
      if (!match) return { valid: false, error: `Please choose one of: ${options.join(", ")}` };
      return { valid: true, value: match };
    }
    case "multi": {
      const options = question.options ?? [];
      const selected = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const invalid = selected.filter((s) => !options.some((o) => o.toLowerCase() === s.toLowerCase()));
      if (invalid.length > 0) return { valid: false, error: `Unknown options: ${invalid.join(", ")}` };
      const matched = selected.map((s) => options.find((o) => o.toLowerCase() === s.toLowerCase())!);
      return { valid: true, value: matched };
    }
    case "numeric": {
      const n = Number(raw.trim());
      if (Number.isNaN(n)) return { valid: false, error: "Please enter a number." };
      const [min, max] = question.range ?? [-Infinity, Infinity];
      if (n < min || n > max) return { valid: false, error: `Please enter a number between ${min} and ${max}.` };
      return { valid: true, value: n };
    }
    default:
      return { valid: true, value: raw.trim() };
  }
}

// ─── Interview Session ────────────────────────────────────────────────────────

export class InterviewSession {
  private _questions: Map<string, InterviewQuestion>;
  private _answers: Map<string, InterviewAnswer> = new Map();
  private _queue: string[];  // ordered IDs to ask next
  private _status: InterviewStatus = "not-started";

  constructor(questions: InterviewQuestion[]) {
    this._questions = new Map(questions.map((q) => [q.id, q]));
    // Exclude branch-target questions from the initial queue —
    // they are inserted dynamically when their parent yes/no is answered.
    const branchTargets = new Set<string>();
    for (const q of questions) {
      if (q.ifYes) branchTargets.add(q.ifYes);
      if (q.ifNo) branchTargets.add(q.ifNo);
    }
    this._queue = questions.filter((q) => !branchTargets.has(q.id)).map((q) => q.id);
  }

  get status(): InterviewStatus { return this._status; }
  get answeredCount(): number { return this._answers.size; }
  get totalQuestions(): number { return this._questions.size; }

  /** The next question to ask, or undefined if done. */
  get currentQuestion(): InterviewQuestion | undefined {
    if (this._queue.length === 0) return undefined;
    return this._questions.get(this._queue[0]!);
  }

  start(): void {
    this._status = "in-progress";
  }

  /**
   * Record an answer to the current question.
   * Returns true if the answer was valid and recorded.
   */
  answer(raw: string): { success: boolean; error?: string } {
    const q = this.currentQuestion;
    if (!q) return { success: false, error: "No current question." };

    const validation = validateAnswer(q, raw);
    if (!validation.valid) return { success: false, error: validation.error };

    const ans: InterviewAnswer = {
      questionId: q.id,
      value: validation.value!,
      answeredAt: new Date().toISOString(),
      skipped: false,
    };
    this._answers.set(q.id, ans);
    this._queue.shift();  // remove current

    // Branch on yes/no
    if (q.kind === "yes_no") {
      const followUp = validation.value === true ? q.ifYes : q.ifNo;
      if (followUp && this._questions.has(followUp) && !this._answers.has(followUp)) {
        this._queue.unshift(followUp);  // insert at front
      }
    }

    if (this._queue.length === 0) {
      this._status = "complete";
    }

    return { success: true };
  }

  /**
   * Skip the current question (only if marked optional).
   */
  skip(): boolean {
    const q = this.currentQuestion;
    if (!q || !q.optional) return false;

    this._answers.set(q.id, {
      questionId: q.id,
      value: "",
      answeredAt: new Date().toISOString(),
      skipped: true,
    });
    this._queue.shift();
    if (this._queue.length === 0) this._status = "complete";
    return true;
  }

  abandon(): void {
    this._status = "abandoned";
  }

  getAnswer(id: string): InterviewAnswer | undefined { return this._answers.get(id); }

  getAllAnswers(): InterviewAnswer[] { return [...this._answers.values()]; }

  /**
   * Format the current question for display to the user / model.
   */
  formatCurrentQuestion(): string {
    const q = this.currentQuestion;
    if (!q) return "(No more questions.)";

    const lines: string[] = [`**[${q.category}]** ${q.text}`];
    if (q.kind === "choice" || q.kind === "multi") {
      lines.push(`Options: ${q.options?.join(" | ")}`);
    } else if (q.kind === "yes_no") {
      lines.push("Answer: yes / no");
    } else if (q.kind === "numeric" && q.range) {
      lines.push(`Range: ${q.range[0]}–${q.range[1]}`);
    }
    if (q.optional) lines.push("_(optional — type 'skip' to skip)_");
    return lines.join("\n");
  }
}

// ─── Requirements Builder ─────────────────────────────────────────────────────

/**
 * Synthesize a RequirementsDocument from a completed InterviewSession.
 */
export function buildRequirementsDocument(
  session: InterviewSession,
  projectName: string,
  projectKind: ProjectKind,
): RequirementsDocument {
  const answers = session.getAllAnswers().filter((a) => !a.skipped);

  // Group by category
  const categories: Record<string, InterviewAnswer[]> = {};
  for (const ans of answers) {
    const q = (session as unknown as { _questions: Map<string, InterviewQuestion> })._questions?.get(ans.questionId);
    const cat = (q as InterviewQuestion | undefined)?.category ?? "general";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(ans);
  }

  // Pull functional requirements (answers to "features" category)
  const functional = (categories["features"] ?? [])
    .map((a) => (Array.isArray(a.value) ? a.value.join(", ") : String(a.value)))
    .filter(Boolean);

  // Pull constraints (answers to "constraints" category)
  const constraints = (categories["constraints"] ?? [])
    .map((a) => String(a.value))
    .filter(Boolean);

  // Pull quality requirements
  const quality = (categories["quality"] ?? [])
    .map((a) => String(a.value))
    .filter(Boolean);

  // Description from "overview" category
  const overviewAns = (categories["overview"] ?? [])[0];
  const description = overviewAns ? String(overviewAns.value) : "";

  return {
    projectName,
    projectKind,
    description,
    functionalRequirements: functional,
    constraints,
    qualityRequirements: quality,
    categories,
    rawAnswers: answers,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Format a RequirementsDocument for prompt injection.
 */
export function formatRequirementsForPrompt(doc: RequirementsDocument): string {
  const lines: string[] = [
    `## Project Requirements — ${doc.projectName}`,
    `**Type:** ${doc.projectKind}`,
    `**Description:** ${doc.description || "(not provided)"}`,
    "",
  ];

  if (doc.functionalRequirements.length > 0) {
    lines.push("### Functional Requirements");
    for (const r of doc.functionalRequirements) lines.push(`- ${r}`);
    lines.push("");
  }

  if (doc.constraints.length > 0) {
    lines.push("### Constraints");
    for (const c of doc.constraints) lines.push(`- ${c}`);
    lines.push("");
  }

  if (doc.qualityRequirements.length > 0) {
    lines.push("### Quality Requirements");
    for (const q of doc.qualityRequirements) lines.push(`- ${q}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Question Bank ────────────────────────────────────────────────────────────

let _qIdCounter = 0;

function q(
  kind: QuestionKind,
  text: string,
  category: string,
  opts: Partial<Omit<InterviewQuestion, "id" | "kind" | "text" | "category">> = {},
): InterviewQuestion {
  return { id: `q${++_qIdCounter}`, kind, text, category, ...opts };
}

export const WEB_APP_QUESTIONS: InterviewQuestion[] = [
  q("freeform", "Describe what the application does in one or two sentences.", "overview"),
  q("choice", "What is the primary user of this application?", "overview", {
    options: ["end-user (consumer)", "developer/internal", "business (B2B)"],
  }),
  q("multi", "Which features are required for MVP?", "features", {
    options: ["authentication", "database", "file-upload", "email", "payments", "real-time", "search", "notifications"],
    optional: true,
  }),
  q("choice", "What frontend framework should be used?", "constraints", {
    options: ["React", "Vue", "Angular", "Svelte", "plain HTML", "no preference"],
  }),
  q("choice", "What backend language/framework is preferred?", "constraints", {
    options: ["Node.js/Express", "Python/FastAPI", "Python/Django", "Go", "Ruby on Rails", "no preference"],
  }),
  q("yes_no", "Does the application need to support mobile browsers?", "quality"),
  q("yes_no", "Is offline support required?", "quality"),
  q("numeric", "What is the expected number of concurrent users at launch?", "constraints", {
    range: [1, 1_000_000], optional: true,
  }),
  q("freeform", "Are there any specific integrations required (APIs, services)?", "constraints", { optional: true }),
];

export const CLI_TOOL_QUESTIONS: InterviewQuestion[] = [
  q("freeform", "What does this CLI tool do in one sentence?", "overview"),
  q("choice", "What language should the CLI be written in?", "constraints", {
    options: ["TypeScript/Node.js", "Python", "Go", "Rust", "Bash", "no preference"],
  }),
  q("yes_no", "Should the tool support config files?", "features"),
  q("yes_no", "Does it need to run as a dae" + "mon / background process?", "features"),
  q("multi", "Which output formats should be supported?", "features", {
    options: ["plain text", "JSON", "YAML", "table", "color/rich"],
    optional: true,
  }),
  q("yes_no", "Will it be published to npm / PyPI / homebrew?", "constraints", { optional: true }),
];

export const QUESTION_BANKS: Record<ProjectKind, InterviewQuestion[]> = {
  "web-app": WEB_APP_QUESTIONS,
  "cli-tool": CLI_TOOL_QUESTIONS,
  "library": [],
  "api-server": [],
  "mobile-app": [],
  "data-pipeline": [],
  "unknown": [],
};

export function createInterviewSession(projectKind: ProjectKind): InterviewSession {
  const questions = QUESTION_BANKS[projectKind] ?? [];
  return new InterviewSession(questions);
}
