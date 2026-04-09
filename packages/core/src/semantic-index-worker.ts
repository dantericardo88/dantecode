// ============================================================================
// @dantecode/core — Semantic Index Worker
// Background indexing worker logic (runs in same process for now)
// Future: migrate to Worker threads for true parallelism
// ============================================================================

import { BackgroundSemanticIndex } from "./semantic-index.js";

/**
 * This module provides background indexing infrastructure.
 * Currently implemented as async functions that run in the same process.
 *
 * Future enhancement: migrate to Worker threads using node:worker_threads
 * for true parallelism and isolation.
 *
 * The BackgroundSemanticIndex class already implements non-blocking indexing
 * by starting the index build in a Promise and tracking readiness state.
 */

export interface WorkerMessage {
  type: "index-file" | "batch-index" | "shutdown";
  payload: unknown;
}

export interface WorkerResponse {
  type: "progress" | "complete" | "error";
  payload: unknown;
}

/**
 * Creates a background semantic index instance.
 * Worker threads migration deferred — BackgroundSemanticIndex provides
 * equivalent non-blocking indexing via Promise queuing.
 */
export function createIndexWorker(): BackgroundSemanticIndex {
  // Worker threads migration deferred — BackgroundSemanticIndex provides
  // equivalent non-blocking indexing via Promise queuing.
  return new BackgroundSemanticIndex({
    projectRoot: process.cwd(),
    sessionId: "worker-default",
  });
}
