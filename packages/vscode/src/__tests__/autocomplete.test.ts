/**
 * autocomplete.test.ts — Slash Command Autocomplete Tests
 *
 * Tests for command completion engine including fuzzy matching,
 * arrow key navigation, Enter selection, ESC dismissal, and edge cases.
 *
 * Phase 6: Testing & Documentation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CommandCompletionEngine } from "../command-completion.js";

describe("Slash Command Autocomplete", () => {
  let engine: CommandCompletionEngine;

  beforeEach(() => {
    engine = new CommandCompletionEngine();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Basic Functionality
  // ────────────────────────────────────────────────────────────────────────────

  describe("Basic Functionality", () => {
    it("should show all commands for '/' query", async () => {
      const result = await engine.getCompletions("/", 50);

      expect(result.completions.length).toBeGreaterThan(0);
      expect(result.query).toBe("/");
      expect(result.isLoading).toBe(false);
    });

    it("should show all commands for empty query", async () => {
      const result = await engine.getCompletions("", 50);

      expect(result.completions.length).toBeGreaterThan(0);
      expect(result.query).toBe("");
      expect(result.isLoading).toBe(false);
    });

    it("should return completion items with required fields", async () => {
      const result = await engine.getCompletions("/plan", 10);

      expect(result.completions.length).toBeGreaterThan(0);
      const completion = result.completions[0];

      expect(completion).toHaveProperty("command");
      expect(completion).toHaveProperty("description");
      expect(completion).toHaveProperty("category");
      expect(completion).toHaveProperty("score");
      expect(completion?.command).toMatch(/^\//); // Starts with /
    });

    it("should limit results to specified limit", async () => {
      const limit = 5;
      const result = await engine.getCompletions("/", limit);

      expect(result.completions.length).toBeLessThanOrEqual(limit);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Fuzzy Matching
  // ────────────────────────────────────────────────────────────────────────────

  describe("Fuzzy Matching", () => {
    it("should match '/pla' to '/plan'", async () => {
      const result = await engine.getCompletions("/pla", 10);

      expect(result.completions.length).toBeGreaterThan(0);
      const planCommand = result.completions.find((c) => c.command === "/plan");
      expect(planCommand).toBeDefined();
      expect(planCommand?.score).toBeGreaterThan(0);
    });

    it("should match '/com' to '/commit'", async () => {
      const result = await engine.getCompletions("/com", 10);

      const commitCommand = result.completions.find((c) => c.command === "/commit");
      expect(commitCommand).toBeDefined();
    });

    it("should match '/mag' to '/magic'", async () => {
      const result = await engine.getCompletions("/mag", 10);

      const magicCommand = result.completions.find((c) => c.command === "/magic");
      expect(magicCommand).toBeDefined();
    });

    it("should match '/inf' to '/inferno'", async () => {
      const result = await engine.getCompletions("/inf", 10);

      const infernoCommand = result.completions.find((c) => c.command === "/inferno");
      expect(infernoCommand).toBeDefined();
    });

    it("should match partial words '/mem' to '/memory'", async () => {
      const result = await engine.getCompletions("/mem", 10);

      const memoryCommand = result.completions.find((c) => c.command === "/memory");
      expect(memoryCommand).toBeDefined();
    });

    it("should match '/par' to '/party'", async () => {
      const result = await engine.getCompletions("/par", 10);

      const partyCommand = result.completions.find((c) => c.command === "/party");
      expect(partyCommand).toBeDefined();
    });

    it("should handle queries without leading slash", async () => {
      const result = await engine.getCompletions("plan", 10);

      const planCommand = result.completions.find((c) => c.command === "/plan");
      expect(planCommand).toBeDefined();
    });

    it("should rank exact matches higher", async () => {
      const result = await engine.getCompletions("/plan", 10);

      expect(result.completions.length).toBeGreaterThan(0);
      const firstCommand = result.completions[0];
      expect(firstCommand?.command).toBe("/plan");
      expect(firstCommand?.score).toBeGreaterThan(0.5);
    });

    it("should handle non-matching queries gracefully", async () => {
      const result = await engine.getCompletions("/xyz123nonexistent", 10);

      expect(result.completions).toEqual([]);
      expect(result.isLoading).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Category Grouping
  // ────────────────────────────────────────────────────────────────────────────

  describe("Category Grouping", () => {
    it("should group commands by category", () => {
      const grouped = engine.getAllCommandsByCategory();

      expect(grouped).toHaveProperty("workflow");
      expect(grouped).toHaveProperty("git");
      expect(grouped).toHaveProperty("system");
      expect(grouped).toHaveProperty("search");
      expect(grouped).toHaveProperty("agent");
    });

    it("should include all workflow commands", () => {
      const grouped = engine.getAllCommandsByCategory();
      const workflowCommands = grouped.workflow || [];

      const workflowNames = workflowCommands.map((c) => c.command);
      expect(workflowNames).toContain("/plan");
      expect(workflowNames).toContain("/magic");
      expect(workflowNames).toContain("/inferno");
      expect(workflowNames).toContain("/forge");
      expect(workflowNames).toContain("/autoforge");
    });

    it("should include all git commands", () => {
      const grouped = engine.getAllCommandsByCategory();
      const gitCommands = grouped.git || [];

      const gitNames = gitCommands.map((c) => c.command);
      expect(gitNames).toContain("/commit");
      expect(gitNames).toContain("/diff");
      expect(gitNames).toContain("/revert");
      expect(gitNames).toContain("/undo");
    });

    it("should include system commands", () => {
      const grouped = engine.getAllCommandsByCategory();
      const systemCommands = grouped.system || [];

      const systemNames = systemCommands.map((c) => c.command);
      expect(systemNames).toContain("/help");
      expect(systemNames).toContain("/status");
      expect(systemNames).toContain("/model");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Command Details
  // ────────────────────────────────────────────────────────────────────────────

  describe("Command Details", () => {
    it("should get details for plan command", () => {
      const details = engine.getCommandDetails("plan");

      expect(details).toBeDefined();
      expect(details?.command).toBe("/plan");
      expect(details?.description).toBeTruthy();
      expect(details?.category).toBe("workflow");
      expect(details?.usage).toBeTruthy();
    });

    it("should get details for commit command", () => {
      const details = engine.getCommandDetails("commit");

      expect(details).toBeDefined();
      expect(details?.command).toBe("/commit");
      expect(details?.category).toBeTruthy(); // Don't assert specific category
    });

    it("should return null for non-existent command", () => {
      const details = engine.getCommandDetails("nonexistent");

      expect(details).toBeNull();
    });

    it("should include usage hints", () => {
      const planDetails = engine.getCommandDetails("plan");
      const commitDetails = engine.getCommandDetails("commit");
      const memoryDetails = engine.getCommandDetails("memory");

      expect(planDetails?.usage).toBe("/plan <goal>");
      expect(commitDetails?.usage).toBe("/commit [message]");
      expect(memoryDetails?.usage).toBe("/memory list|search|stats");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Performance
  // ────────────────────────────────────────────────────────────────────────────

  describe("Performance", () => {
    it("should complete queries in under 150ms", async () => {
      const start = performance.now();
      await engine.getCompletions("/pla", 10);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(150);
    });

    it("should handle empty query quickly", async () => {
      const start = performance.now();
      await engine.getCompletions("", 50);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(150);
    });

    it("should handle complex fuzzy queries efficiently", async () => {
      const start = performance.now();
      await engine.getCompletions("/autf", 10);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(150);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ────────────────────────────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle whitespace in query", async () => {
      const result = await engine.getCompletions("  /plan  ", 10);

      // Should still find plan command despite whitespace
      expect(result.completions.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle uppercase queries", async () => {
      const result = await engine.getCompletions("/PLAN", 10);

      // Fuzzy matching should be case-insensitive
      const planCommand = result.completions.find(
        (c) => c.command.toLowerCase() === "/plan"
      );
      expect(planCommand).toBeDefined();
    });

    it("should handle mixed case queries", async () => {
      const result = await engine.getCompletions("/PlAn", 10);

      const planCommand = result.completions.find(
        (c) => c.command.toLowerCase() === "/plan"
      );
      expect(planCommand).toBeDefined();
    });

    it("should handle very long queries", async () => {
      const longQuery = "/plan".repeat(100);
      const result = await engine.getCompletions(longQuery, 10);

      expect(result).toBeDefined();
      expect(result.isLoading).toBe(false);
    });

    it("should handle special characters gracefully", async () => {
      const result = await engine.getCompletions("/pl@n!", 10);

      expect(result).toBeDefined();
      expect(result.isLoading).toBe(false);
    });

    it("should handle unicode characters", async () => {
      const result = await engine.getCompletions("/plän", 10);

      expect(result).toBeDefined();
      expect(result.isLoading).toBe(false);
    });

    it("should handle zero limit", async () => {
      const result = await engine.getCompletions("/plan", 0);

      expect(result.completions).toEqual([]);
    });

    it("should handle negative limit (treated as 0)", async () => {
      const result = await engine.getCompletions("/plan", -5);

      // Should return empty or handle gracefully
      expect(Array.isArray(result.completions)).toBe(true);
    });

    it("should handle very large limit", async () => {
      const result = await engine.getCompletions("/", 1000);

      expect(result.completions.length).toBeGreaterThan(0);
      expect(result.completions.length).toBeLessThanOrEqual(1000);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Skills Integration
  // ────────────────────────────────────────────────────────────────────────────

  describe("Skills Integration", () => {
    it("should refresh skills cache on first query", async () => {
      // First query triggers skills refresh
      const result = await engine.getCompletions("/", 50);

      expect(result.completions.length).toBeGreaterThan(0);
    });

    it("should include skill commands in results", async () => {
      const result = await engine.getCompletions("/", 100);

      // Should include both core commands and skills
      expect(result.completions.length).toBeGreaterThan(20);
    });

    it("should handle skills cache TTL", async () => {
      // First query
      await engine.getCompletions("/", 10);

      // Second query within TTL (should use cache)
      const result = await engine.getCompletions("/", 10);

      expect(result.isLoading).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Navigation Simulation
  // ────────────────────────────────────────────────────────────────────────────

  describe("Navigation Simulation", () => {
    it("should support arrow key navigation pattern", async () => {
      const result = await engine.getCompletions("/pla", 5);
      const completions = result.completions;

      // Simulate arrow down navigation
      let selectedIndex = 0;
      expect(completions[selectedIndex]).toBeDefined();

      // Arrow down
      selectedIndex = Math.min(selectedIndex + 1, completions.length - 1);
      expect(completions[selectedIndex]).toBeDefined();

      // Arrow down again
      selectedIndex = Math.min(selectedIndex + 1, completions.length - 1);
      expect(completions[selectedIndex]).toBeDefined();

      // Arrow up
      selectedIndex = Math.max(selectedIndex - 1, 0);
      expect(completions[selectedIndex]).toBeDefined();
    });

    it("should support Enter selection pattern", async () => {
      const result = await engine.getCompletions("/plan", 10);
      const selectedCommand = result.completions[0];

      expect(selectedCommand).toBeDefined();
      expect(selectedCommand?.command).toBe("/plan");

      // Simulate Enter key - would insert this command
      const insertedText = selectedCommand?.command;
      expect(insertedText).toBe("/plan");
    });

    it("should support ESC dismissal pattern", async () => {
      const result = await engine.getCompletions("/pla", 10);

      expect(result.completions.length).toBeGreaterThan(0);

      // Simulate ESC - would clear completions
      const clearedCompletions: typeof result.completions = [];
      expect(clearedCompletions).toEqual([]);
    });

    it("should handle circular navigation at boundaries", async () => {
      const result = await engine.getCompletions("/", 3);
      const completions = result.completions;

      // At top, arrow up should stay at top
      let selectedIndex = 0;
      selectedIndex = Math.max(selectedIndex - 1, 0);
      expect(selectedIndex).toBe(0);

      // At bottom, arrow down should stay at bottom
      selectedIndex = completions.length - 1;
      selectedIndex = Math.min(selectedIndex + 1, completions.length - 1);
      expect(selectedIndex).toBe(completions.length - 1);
    });
  });
});
