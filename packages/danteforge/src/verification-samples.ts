// ============================================================================
// @dantecode/danteforge — Verification Samples
// Demonstrates DanteForge PDSE scoring capabilities with real code examples.
// ============================================================================

import { runLocalPDSEScorer } from "./index.js";
import type { PDSEScore } from "@dantecode/config-types";

// Sample 1: Good code (should score high)
export const GOOD_CODE_SAMPLE = `
function calculateTotal(items: Array<{price: number, quantity: number}>): number {
  return items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);
}

// Usage
const cart = [
  { price: 10.99, quantity: 2 },
  { price: 5.49, quantity: 1 }
];

console.log('Total:', calculateTotal(cart));
`;

// Sample 2: Stubbed/placeholder code (should score low)
export const STUB_CODE_SAMPLE = `
function calculateTotal(items) {
  // TODO: implement this function
  return 0;
}

// Usage
const cart = [];
console.log('Total:', calculateTotal(cart));
`;

// Sample 3: Code with hallucinations (should score low)
export const HALLUCINATION_CODE_SAMPLE = `
function calculateTotal(items: Array<{price: number, quantity: number}>): number {
  return items.map(item => item.price).sum(); // .sum() doesn't exist on arrays
}

// Usage
const cart = [
  { price: 10.99, quantity: 2 },
  { price: 5.49, quantity: 1 }
];

console.log('Total:', calculateTotal(cart));
`;

// Sample 4: Inconsistent code (should score medium)
export const INCONSISTENT_CODE_SAMPLE = `
function calculate_total(items) {  // snake_case in JS
  let total = 0;
  for (let i = 0; i < items.length; i++) {  // old-style for loop
    total += items[i].price * items[i].quantity;
  }
  return total;
}

const cart = [
  { price: 10.99, quantity: 2 },
  { price: 5.49, quantity: 1 }
];

console.log('Total:', calculate_total(cart));  // inconsistent naming
`;

/**
 * Run verification on all sample codes to demonstrate PDSE scoring.
 */
export function runVerificationSamples(): Array<{
  name: string;
  code: string;
  score: PDSEScore;
}> {
  const samples = [
    { name: "Good Code", code: GOOD_CODE_SAMPLE },
    { name: "Stubbed Code", code: STUB_CODE_SAMPLE },
    { name: "Hallucination Code", code: HALLUCINATION_CODE_SAMPLE },
    { name: "Inconsistent Code", code: INCONSISTENT_CODE_SAMPLE },
  ];

  return samples.map(({ name, code }) => ({
    name,
    code,
    score: runLocalPDSEScorer(code, "/tmp"),
  }));
}

/**
 * Get expected scores for samples (for testing).
 */
export function getExpectedSampleScores(): Array<{
  name: string;
  minScore: number;
  maxScore: number;
}> {
  return [
    { name: "Good Code", minScore: 85, maxScore: 100 },
    { name: "Stubbed Code", minScore: 0, maxScore: 30 },
    { name: "Hallucination Code", minScore: 20, maxScore: 50 },
    { name: "Inconsistent Code", minScore: 50, maxScore: 75 },
  ];
}
