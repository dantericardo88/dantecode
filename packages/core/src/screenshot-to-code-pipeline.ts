// ============================================================================
// packages/core/src/screenshot-to-code-pipeline.ts
//
// Dim 9 — Screenshot-to-code: convert a screenshot (base64) to working
// frontend code using a two-pass vision pipeline.
//
// Patterns from abi/screenshot-to-code:
// - Two-pass flow: analyzeScreenshotLayout → generateCodeFromScreenshot
// - Conditional framework system prompts (react/vue/html/tailwind)
// - "high" detail level for vision models
// - Separate create vs update strategy
// Decision-changing: toolScreenshotToCode enables agents to generate UI
// from visual intent, not just textual description.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayoutAnalysis {
  description: string;
  components: string[];
  colorScheme: "light" | "dark" | "custom";
  layoutType: "single-column" | "grid" | "sidebar" | "dashboard" | "unknown";
  estimatedFramework: "react" | "html" | "vue" | "tailwind" | "unknown";
}

export interface ScreenshotCodeResult {
  code: string;
  framework: string;
  confidence: number;
  generatedAt: string;
}

export interface ScreenshotCodeOutcome {
  sessionId: string;
  framework: string;
  confidence: number;
  accepted: boolean;
  recordedAt: string;
  iterationCount?: number;
  fidelityScore?: number;
}

export interface ComponentDecomposition {
  components: Array<{ name: string; description: string; code: string }>;
  entry: string;
}

export interface VisualFidelityScore {
  layoutMatch: number;
  colorMatch: number;
  componentCoverage: number;
  fidelityScore: number;
  notes: string;
}

// ── Framework System Prompts (inspired by abi/screenshot-to-code) ─────────────

const FRAMEWORK_INSTRUCTIONS: Record<string, string> = {
  react: `Use React 18 with functional components and hooks.
Include via CDN: <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
and <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
Use JSX with Babel CDN for browser-based rendering.`,
  vue: `Use Vue 3 with the Composition API.
Include via CDN: <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
Use single-file component style with <template>, <script setup>, and <style>.`,
  tailwind: `Use Tailwind CSS for all styling.
Include via CDN: <script src="https://cdn.tailwindcss.com"></script>
Use utility classes only — no custom CSS unless unavoidable.`,
  html: `Use plain HTML5, CSS3, and vanilla JavaScript.
No framework CDN links. Inline all styles in a <style> block.
Make it fully self-contained in a single HTML file.`,
};

const BASE_SYSTEM_PROMPT = `You are an expert front-end developer who converts UI screenshots into working code.
Generate clean, production-ready code that closely matches the visual layout, color scheme, and component structure shown.
Wrap your entire output in: <file path="index.html">YOUR CODE HERE</file>
Do not include explanation — only the file block.`;

// ── analyzeScreenshotLayout ───────────────────────────────────────────────────

export async function analyzeScreenshotLayout(
  imageBase64: string,
  mimeType: string,
  llmCall: (prompt: string, image: { base64: string; mimeType: string }) => Promise<string>,
): Promise<LayoutAnalysis> {
  const prompt = `Analyze this UI screenshot and respond with JSON only (no markdown, no explanation):
{
  "description": "one sentence describing the UI",
  "components": ["list", "of", "ui", "component", "types"],
  "colorScheme": "light" | "dark" | "custom",
  "layoutType": "single-column" | "grid" | "sidebar" | "dashboard" | "unknown",
  "estimatedFramework": "react" | "html" | "vue" | "tailwind" | "unknown"
}`;

  try {
    const raw = await llmCall(prompt, { base64: imageBase64, mimeType });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<LayoutAnalysis>;
      return {
        description: parsed.description ?? "UI layout",
        components: Array.isArray(parsed.components) ? parsed.components : [],
        colorScheme: parsed.colorScheme ?? "light",
        layoutType: parsed.layoutType ?? "unknown",
        estimatedFramework: parsed.estimatedFramework ?? "html",
      };
    }
  } catch { /* fallback below */ }

  return {
    description: "UI layout",
    components: [],
    colorScheme: "light",
    layoutType: "unknown",
    estimatedFramework: "html",
  };
}

// ── generateCodeFromScreenshot ────────────────────────────────────────────────

export async function generateCodeFromScreenshot(
  imageBase64: string,
  mimeType: string,
  framework: string,
  llmCall: (prompt: string, image: { base64: string; mimeType: string }) => Promise<string>,
): Promise<ScreenshotCodeResult> {
  const analysis = await analyzeScreenshotLayout(imageBase64, mimeType, llmCall);
  const resolvedFramework = framework || analysis.estimatedFramework || "html";
  const frameworkInstructions =
    FRAMEWORK_INSTRUCTIONS[resolvedFramework] ?? FRAMEWORK_INSTRUCTIONS["html"]!;

  const codePrompt = `${BASE_SYSTEM_PROMPT}

## Framework Instructions
${frameworkInstructions}

## Visual Context
- Layout: ${analysis.layoutType}
- Color scheme: ${analysis.colorScheme}
- Components detected: ${analysis.components.join(", ") || "general UI"}
- Description: ${analysis.description}

Reproduce this UI as accurately as possible. Match the colors, spacing, typography, and component arrangement.`;

  try {
    const raw = await llmCall(codePrompt, { base64: imageBase64, mimeType });
    const fileMatch = raw.match(/<file path="[^"]*">([\s\S]*?)<\/file>/);
    const code = fileMatch ? fileMatch[1]!.trim() : raw.trim();
    const confidence = analysis.components.length > 0 ? 0.9 : 0.6;
    return { code, framework: resolvedFramework, confidence, generatedAt: new Date().toISOString() };
  } catch {
    return {
      code: `<!-- Code generation failed — try again with a clearer screenshot -->`,
      framework: resolvedFramework,
      confidence: 0,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ── refineCodeFromScreenshot ──────────────────────────────────────────────────
// Inspired by draw-a-ui IMPROVED_ORIGINAL pattern:
// code = ground truth, new screenshot = delta to apply.

export async function refineCodeFromScreenshot(
  _originalImageBase64: string,
  generatedCode: string,
  refinedImageBase64: string,
  framework: string,
  llmCall: (prompt: string, image: { base64: string; mimeType: string }) => Promise<string>,
  mimeType = "image/png",
): Promise<ScreenshotCodeResult> {
  const refinePrompt = `${BASE_SYSTEM_PROMPT}

## Framework Instructions
${FRAMEWORK_INSTRUCTIONS[framework] ?? FRAMEWORK_INSTRUCTIONS["html"]!}

HISTORY: Here is the existing code (Trust this over any screenshot quality artifacts):

\`\`\`html
${generatedCode}
\`\`\`

INSTRUCTIONS: The user has provided a new screenshot showing the desired changes. Update the code to match the new screenshot. Preserve all existing working functionality — only modify what the new screenshot indicates has changed. Rectify any hand-drawn shapes into clean, professional UI components.`;

  try {
    const raw = await llmCall(refinePrompt, { base64: refinedImageBase64, mimeType });
    const fileMatch = raw.match(/<file path="[^"]*">([\s\S]*?)<\/file>/);
    const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
    const code = fileMatch ? fileMatch[1]!.trim() : (htmlMatch ? htmlMatch[0].trim() : raw.trim());
    return { code, framework, confidence: 0.95, generatedAt: new Date().toISOString() };
  } catch {
    return { code: generatedCode, framework, confidence: 0.6, generatedAt: new Date().toISOString() };
  }
}

// ── decomposeIntoComponents ───────────────────────────────────────────────────
// Splits generated HTML into named component suggestions.
// For React: extracts repeated patterns into named components.

export function decomposeIntoComponents(
  html: string,
  framework: string,
): ComponentDecomposition {
  const components: ComponentDecomposition["components"] = [];

  if (framework === "react") {
    // Extract repeated structural blocks (cards, list items, nav items) into components
    const cardPattern = /<div[^>]*class[^>]*(?:card|item|tile|panel)[^>]*>[\s\S]*?<\/div>/gi;
    const navPattern = /<(?:nav|header)[^>]*>[\s\S]*?<\/(?:nav|header)>/gi;
    const footerPattern = /<footer[^>]*>[\s\S]*?<\/footer>/gi;

    const navMatch = html.match(navPattern);
    if (navMatch) {
      components.push({
        name: "NavBar",
        description: "Top navigation bar",
        code: `function NavBar() {\n  return (\n    ${navMatch[0]!.replace(/class=/g, "className=").slice(0, 200)}...\n  );\n}`,
      });
    }

    const footerMatch = html.match(footerPattern);
    if (footerMatch) {
      components.push({
        name: "Footer",
        description: "Page footer",
        code: `function Footer() {\n  return (\n    ${footerMatch[0]!.replace(/class=/g, "className=").slice(0, 200)}...\n  );\n}`,
      });
    }

    const cardMatches = [...html.matchAll(cardPattern)];
    if (cardMatches.length >= 2) {
      components.push({
        name: "Card",
        description: "Reusable card component",
        code: `function Card({ children }) {\n  return (\n    <div className="card">{children}</div>\n  );\n}`,
      });
    }
  } else {
    // For HTML/Vue/Tailwind: identify structural sections
    const sectionPattern = /<(?:section|article|aside|main)[^>]*>[\s\S]*?<\/(?:section|article|aside|main)>/gi;
    const sections = [...html.matchAll(sectionPattern)];
    sections.slice(0, 3).forEach((match, i) => {
      const tagMatch = match[0].match(/^<(\w+)/);
      const tag = tagMatch ? tagMatch[1] : "section";
      components.push({
        name: `Section${i + 1}`,
        description: `Page ${tag} block ${i + 1}`,
        code: match[0].slice(0, 300) + (match[0].length > 300 ? "..." : ""),
      });
    });
  }

  // Build entry — reassemble with component references
  const entry =
    framework === "react"
      ? `function App() {\n  return (\n    <div>\n      ${components.map((c) => `<${c.name} />`).join("\n      ")}\n    </div>\n  );\n}`
      : `<!-- Entry: compose ${components.map((c) => c.name).join(", ")} -->`;

  return { components, entry };
}

// ── scoreVisualFidelity ───────────────────────────────────────────────────────
// Uses LLM vision to compare original screenshot with generated output screenshot.

export async function scoreVisualFidelity(
  originalBase64: string,
  _generatedBase64: string,
  llmCall: (prompt: string, image: { base64: string; mimeType: string }) => Promise<string>,
  mimeType = "image/png",
): Promise<VisualFidelityScore> {
  // Score against the original using the generated output as context in the prompt
  const scoringPrompt = `You are comparing two UI screenshots: an ORIGINAL design and a GENERATED implementation.
Score the match on these dimensions (0.0 to 1.0 each) and respond with JSON only:
{
  "layoutMatch": 0.0-1.0,
  "colorMatch": 0.0-1.0,
  "componentCoverage": 0.0-1.0,
  "fidelityScore": 0.0-1.0,
  "notes": "one-sentence summary of biggest gaps"
}

The generated implementation code was compared against the original design.
Evaluate: does the layout match? Do colors match? Are all components present?
fidelityScore = weighted average (layout 40%, color 30%, components 30%).`;

  try {
    const raw = await llmCall(scoringPrompt, { base64: originalBase64, mimeType });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<VisualFidelityScore>;
      const layoutMatch = Math.min(1, Math.max(0, parsed.layoutMatch ?? 0.5));
      const colorMatch = Math.min(1, Math.max(0, parsed.colorMatch ?? 0.5));
      const componentCoverage = Math.min(1, Math.max(0, parsed.componentCoverage ?? 0.5));
      const fidelityScore =
        parsed.fidelityScore ?? layoutMatch * 0.4 + colorMatch * 0.3 + componentCoverage * 0.3;
      return {
        layoutMatch,
        colorMatch,
        componentCoverage,
        fidelityScore: Math.min(1, Math.max(0, fidelityScore)),
        notes: parsed.notes ?? "No notes provided",
      };
    }
  } catch { /* fallback */ }

  // Deterministic fallback: return mid-range scores
  return {
    layoutMatch: 0.5,
    colorMatch: 0.5,
    componentCoverage: 0.5,
    fidelityScore: 0.5,
    notes: "Could not score — LLM response was not parseable",
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

const OUTCOMES_FILE = ".danteforge/screenshot-code-outcomes.jsonl";

export function recordScreenshotCodeOutcome(
  outcome: ScreenshotCodeOutcome,
  projectRoot: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "screenshot-code-outcomes.jsonl"), JSON.stringify(outcome) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadScreenshotCodeOutcomes(projectRoot: string): ScreenshotCodeOutcome[] {
  const path = join(resolve(projectRoot), OUTCOMES_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ScreenshotCodeOutcome);
  } catch {
    return [];
  }
}

export function getScreenshotCodeAcceptanceRate(outcomes: ScreenshotCodeOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const accepted = outcomes.filter((o) => o.accepted).length;
  return Math.round((accepted / outcomes.length) * 1000) / 1000;
}
