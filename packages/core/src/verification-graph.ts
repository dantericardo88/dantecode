import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { EventSourcedCheckpointer } from "./checkpointer.js";
import { criticDebate, type CriticDebateResult, type CriticOpinion } from "./critic-debater.js";
import {
  verifyOutput,
  type OutputVerificationReport,
  type VerifyOutputInput,
} from "./qa-harness.js";

export interface VerificationGraphInput extends VerifyOutputInput {
  traceId?: string;
  criticOpinions?: CriticOpinion[];
  metadata?: Record<string, unknown>;
}

export interface VerificationGraphNode {
  id: string;
  stage: OutputVerificationReport["critiqueTrace"][number]["stage"];
  passed: boolean;
  summary: string;
}

export interface VerificationGraphTrace {
  traceId: string;
  task: string;
  output: string;
  report: OutputVerificationReport;
  nodes: VerificationGraphNode[];
  debate?: CriticDebateResult;
  overallPassed: boolean;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  completedAt: string;
}

export interface VerificationGraphRunResult {
  traceId: string;
  checkpointId: string;
  eventCount: number;
  trace: VerificationGraphTrace;
}

export class VerificationGraph {
  private readonly baseDir: string;

  constructor(projectRoot: string, baseDir?: string) {
    this.baseDir = baseDir ?? join(projectRoot, ".danteforge", "reports", "verification-graphs");
    this.projectRoot = projectRoot;
  }

  private readonly projectRoot: string;

  async run(input: VerificationGraphInput): Promise<VerificationGraphRunResult> {
    const traceId = input.traceId ?? randomUUID();
    const checkpointer = this.createCheckpointer(traceId);
    const createdAt = new Date().toISOString();

    await checkpointer.put(
      {
        trace: {
          traceId,
          task: input.task,
          output: input.output,
          nodes: [],
          overallPassed: false,
          summary: "Verification graph started.",
          createdAt,
          completedAt: createdAt,
        },
      },
      {
        source: "input",
        step: 0,
        triggerCommand: "verification-graph",
        ...(input.metadata ? { extra: input.metadata } : {}),
      },
    );

    const report = verifyOutput({
      task: input.task,
      output: input.output,
      ...(input.criteria ? { criteria: input.criteria } : {}),
      ...(input.rails ? { rails: input.rails } : {}),
    });
    const nodes = report.critiqueTrace.map((stage, index) => ({
      id: `${stage.stage}-${index + 1}`,
      stage: stage.stage,
      passed: stage.passed,
      summary: stage.summary,
    }));

    for (const node of nodes) {
      await checkpointer.putWrite({
        taskId: traceId,
        channel: `node:${node.stage}`,
        value: node,
        timestamp: new Date().toISOString(),
      });
    }

    let debate: CriticDebateResult | undefined;
    if (input.criticOpinions && input.criticOpinions.length > 0) {
      debate = criticDebate(input.criticOpinions, input.output);
      await checkpointer.putWrite({
        taskId: traceId,
        channel: "debate",
        value: debate,
        timestamp: new Date().toISOString(),
      });
    }

    const overallPassed = report.overallPassed && (debate ? debate.consensus !== "fail" : true);
    const completedAt = new Date().toISOString();
    const trace: VerificationGraphTrace = {
      traceId,
      task: input.task,
      output: input.output,
      report,
      nodes,
      ...(debate ? { debate } : {}),
      overallPassed,
      summary: buildSummary(report, debate, overallPassed),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt,
      completedAt,
    };

    const checkpointId = await checkpointer.put(
      { trace },
      {
        source: "update",
        step: nodes.length + (debate ? 1 : 0) + 1,
        triggerCommand: "verification-graph",
        ...(input.metadata ? { extra: input.metadata } : {}),
      },
    );

    return {
      traceId,
      checkpointId,
      eventCount: checkpointer.getEventCount(),
      trace,
    };
  }

  async resume(traceId: string): Promise<VerificationGraphTrace | null> {
    const checkpointer = this.createCheckpointer(traceId);
    const tuple = await checkpointer.getTuple();
    if (!tuple) {
      return null;
    }

    const trace = tuple.checkpoint.channelValues["trace"];
    return isVerificationGraphTrace(trace) ? trace : null;
  }

  private createCheckpointer(traceId: string): EventSourcedCheckpointer {
    return new EventSourcedCheckpointer(this.projectRoot, traceId, {
      baseDir: this.baseDir,
    });
  }
}

function buildSummary(
  report: OutputVerificationReport,
  debate: CriticDebateResult | undefined,
  overallPassed: boolean,
): string {
  if (debate) {
    return overallPassed
      ? `Verification passed with critic consensus ${debate.consensus}.`
      : `Verification blocked by critic consensus ${debate.consensus}.`;
  }

  return report.overallPassed ? "Verification passed." : "Verification failed.";
}

function isVerificationGraphTrace(value: unknown): value is VerificationGraphTrace {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}
