# DanteCode — Run Receipt Schema

> Schema version: **1.0**
> Source of truth: `packages/evidence-chain/src/` + `packages/cli/src/evidence-chain-bridge.ts`

---

## Overview

Every DanteCode session that writes or proposes code changes emits a tamper-evident
**run receipt chain**. Receipts are cryptographic records of individual verification
events; the chain is sealed at session end with a **CertificationSeal** backed by a
Merkle tree.

The goal is non-technical legibility with cryptographic accountability:
a user who cannot read code can still verify that DanteCode ran its checks,
what passed, and what failed.

---

## Receipt Object

```json
{
  "receiptId": "rc_a3f2b1c7d4e5f6a7",
  "correlationId": "sess_20260324_abc123",
  "actor": "verify:typecheck",
  "action": "verification_pass:typecheck",
  "beforeState": { "command": "tsc --noEmit", "status": "running" },
  "afterState":  { "command": "tsc --noEmit", "status": "passed" },
  "beforeHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "afterHash":  "c7be1ed902fb8dd8e35d36bde05c3a0d5c0b1c9a7f6d4e2b8a1f3c5e7d9b2a4",
  "receiptHash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  "issuedAt": "2026-03-24T12:00:00.000Z"
}
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `receiptId` | `string` | Unique receipt identifier (not a nonce — stable for this event) |
| `correlationId` | `string` | Session ID that groups all receipts for one run |
| `actor` | `string` | Who performed the action (e.g. `verify:typecheck`, `danteforge`, `tool:Bash`) |
| `action` | `string` | What was done (e.g. `verification_pass:typecheck`, `pdse_score:src/index.ts`) |
| `beforeState` | `object` | State snapshot before the action |
| `afterState` | `object` | State snapshot after the action |
| `beforeHash` | `string` | `sha256(stableJSON(beforeState))` — 64-char lowercase hex |
| `afterHash` | `string` | `sha256(stableJSON(afterState))` — 64-char lowercase hex |
| `receiptHash` | `string` | `sha256("{receiptId}:{correlationId}:{actor}:{action}:{beforeHash}:{afterHash}")` |
| `issuedAt` | `string` | ISO 8601 datetime — **nonce field, excluded from reproducibility checks** |

### Reproducibility rule

Two runs of the same code against the same repo state **must** produce the same
`receiptHash` values for all receipts except for `issuedAt` and `receiptId`
(which include per-invocation randomness). The `beforeHash` and `afterHash`
are fully deterministic and are the primary tamper-evident fields.

---

## Evidence Bundle

Each receipt is also wrapped in an **EvidenceBundle** that forms a hash chain:

```json
{
  "bundleId": "ev_a3f2b1c7d4e5f6a7",
  "runId": "sess_20260324_abc123",
  "seq": 0,
  "organ": "verification-pipeline",
  "eventType": "VERIFICATION_PASSED",
  "evidence": {
    "verifyName": "typecheck",
    "command": "tsc --noEmit",
    "passed": true,
    "receiptId": "rc_a3f2b1c7d4e5f6a7"
  },
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
  "timestamp": "2026-03-24T12:00:00.000Z"
}
```

| Field | Description |
|-------|-------------|
| `bundleId` | `"ev_" + 8 random bytes hex` (19 chars total) |
| `seq` | Monotonically increasing sequence number within a session |
| `organ` | Which subsystem created this bundle (`verification-pipeline`, `danteforge-pipeline`, `tool-runtime`) |
| `eventType` | One of: `VERIFICATION_PASSED`, `VERIFICATION_FAILED`, `PDSE_SCORED`, `TOOL_RESULT`, `TOOL_ERROR` |
| `prevHash` | Hash of previous bundle; genesis bundle uses `"0".repeat(64)` |
| `hash` | `sha256(stableJSON(evidence))` — covers only the evidence payload |

---

## Certification Seal

At session end, all receipts are hashed into a Merkle tree and a
**CertificationSeal** is produced:

```json
{
  "sealId": "seal_20260324_abc123",
  "sessionId": "sess_20260324_abc123",
  "timestamp": "2026-03-24T12:05:00.000Z",
  "evidenceRootHash": "f1e2d3c4b5a6978869504132241516070819202122232425262728293031323334",
  "configHash": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
  "metricsHash": "d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2",
  "sealHash": "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
  "metrics": [
    { "metric": "receipts",      "value": 4 },
    { "metric": "bundles",       "value": 4 },
    { "metric": "filesModified", "value": 2 },
    { "metric": "totalRounds",   "value": 3 }
  ],
  "eventCount": 4
}
```

`sealHash = sha256("{sealId}:{timestamp}:{sessionId}:{evidenceRootHash}:{configHash}:{metricsHash}")`

The `evidenceRootHash` is the Merkle root of all receipt hashes in the chain.
Tampering with any single receipt invalidates the Merkle root and thus the seal.

---

## Where receipts are stored

- In-memory during the session via `SessionEvidenceTracker`
- Exported at session end to `.dantecode/receipts/<sessionId>.json`
- The seal is written to `.dantecode/seals/<sessionId>.seal.json`

---

## Verification report (plain-language output)

Every run that writes code prints a human-readable verdict:

```
✓ Verified — no issues found
  Anti-stub scan:     PASSED (0 hard violations)
  Constitution check: PASSED
  PDSE score:         84/100
    Completeness: 82 | Correctness: 87 | Clarity: 83 | Consistency: 84
  PR quality:         79/100  (advisory)
```

Or on failure:

```
⚠ Verification failed — caught 1 stub(s): Function body not implemented
  Anti-stub scan:     FAILED (1 hard violation)
  Constitution check: PASSED
  PDSE score:         62/100
```
