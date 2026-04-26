// ============================================================================
// @dantecode/core — FabricationTracker (Gate 8)
// Session-scoped fabrication counter + rate tracker + strict-mode escalation.
// ============================================================================

const STRICT_MODE_CONSECUTIVE_THRESHOLD = 3;
const STRICT_MODE_RATE_THRESHOLD = 0.3;
const CIRCUIT_OPEN_CONSECUTIVE_THRESHOLD = 3;

export type FabricationEventType =
  | "false_success"
  | "missing_block"
  | "phantom_tool"
  | "epilogue";

export interface FabricationEvent {
  type: FabricationEventType;
  round: number;
  toolName?: string;
  claimedStatus?: "SUCCESS" | "ERROR";
  actualError?: string;
}

export interface FabricationSnapshot {
  totalRoundsWithTools: number;
  totalFabricatedRounds: number;
  consecutiveFabrications: number;
  rate: number;
  strictModeActive: boolean;
  circuitOpen: boolean;
  events: FabricationEvent[];
}

export class FabricationTracker {
  private _totalRoundsWithTools = 0;
  private _fabricatedRounds = 0;
  private _consecutiveFabrications = 0;
  private _events: FabricationEvent[] = [];

  /**
   * Call once per agent round that contained tool calls.
   * toolNames must be non-empty; events is the list of fabrication events found
   * in that round (empty means clean round).
   */
  recordRound(_round: number, toolNames: string[], events: FabricationEvent[]): void {
    if (toolNames.length === 0) return;
    this._totalRoundsWithTools++;
    if (events.length > 0) {
      this._fabricatedRounds++;
      this._consecutiveFabrications++;
      this._events.push(...events);
    } else {
      this._consecutiveFabrications = 0;
    }
  }

  get consecutiveFabrications(): number {
    return this._consecutiveFabrications;
  }

  get fabricationRate(): number {
    return this._totalRoundsWithTools > 0
      ? this._fabricatedRounds / this._totalRoundsWithTools
      : 0;
  }

  get isStrictMode(): boolean {
    return (
      this._consecutiveFabrications >= STRICT_MODE_CONSECUTIVE_THRESHOLD ||
      this.fabricationRate > STRICT_MODE_RATE_THRESHOLD
    );
  }

  get circuitOpen(): boolean {
    return this._consecutiveFabrications >= CIRCUIT_OPEN_CONSECUTIVE_THRESHOLD;
  }

  getStrictModePrompt(): string {
    const n = this._consecutiveFabrications;
    return (
      `⚠️ **STRICT VERIFICATION MODE ACTIVE** — Your last ${n} response${n !== 1 ? "s" : ""} ` +
      `contained fabricated tool outcomes.\n` +
      `MANDATORY: Begin this response with "VERIFICATION AUDIT:" and list every tool result ` +
      `from the previous round verbatim before writing anything else.`
    );
  }

  getSnapshot(): FabricationSnapshot {
    return {
      totalRoundsWithTools: this._totalRoundsWithTools,
      totalFabricatedRounds: this._fabricatedRounds,
      consecutiveFabrications: this._consecutiveFabrications,
      rate: this.fabricationRate,
      strictModeActive: this.isStrictMode,
      circuitOpen: this.circuitOpen,
      events: [...this._events],
    };
  }
}
