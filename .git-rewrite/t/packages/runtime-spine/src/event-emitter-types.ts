/**
 * event-emitter-types.ts
 *
 * Minimal interface for event emission.
 * Allows packages to depend on event emission without circular dependencies on core.
 */

import type { RuntimeEvent } from "./runtime-events.js";

/**
 * Minimal interface for event emission.
 * Implemented by EventEngine in @dantecode/core.
 */
export interface EventEmitter {
  /**
   * Emit a runtime event.
   * @param event The event to emit
   * @returns A promise that resolves when the event has been emitted
   */
  emit(event: RuntimeEvent): Promise<void>;
}
