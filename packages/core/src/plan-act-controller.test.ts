import { describe, it, expect } from 'vitest';
import { parsePlan, formatPlanForDisplay, PlanActController } from './plan-act-controller.js';
import type { ExecutionPlan } from './plan-act-controller.js';

describe('plan-act-controller', () => {
  describe('parsePlan', () => {
    it('parses JSON plan from fenced block', () => {
      const input = `\`\`\`json
      {
        "goal": "test goal",
        "steps": [
          {
            "description": "create file",
            "risk": "medium",
            "affectedFiles": ["src/file.ts"],
            "requiresTool": true
          }
        ]
      }
      \`\`\``;
      const plan = parsePlan(input, 'goal');
      expect(plan.goal).toBe('test goal');
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]?.risk).toBe('medium');
      expect(plan.steps[0]?.affectedFiles).toContain('src/file.ts');
      expect(plan.estimatedChangedFiles).toBe(1);
    });

    it('parses raw JSON plan', () => {
      const input = JSON.stringify({
        goal: 'test goal',
        steps: [{ description: 'read file', risk: 'low' }]
      });
      const plan = parsePlan(input, 'goal');
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]?.risk).toBe('low');
    });

    it('falls back to regex parsing for numbered list', () => {
      const input = `1. Create new file src/app.ts
2. Delete old file old.ts`;
      const plan = parsePlan(input, 'goal');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]?.risk).toBe('medium');
      expect(plan.steps[1]?.risk).toBe('high');
      expect(plan.hasDestructiveSteps).toBe(true);
    });

    it('extracts risk levels correctly', () => {
      const low = parsePlan('1. Read config', 'goal');
      expect(low.steps[0]?.risk).toBe('low');

      const medium = parsePlan('1. create file', 'goal');
      expect(medium.steps[0]?.risk).toBe('medium');

      const high = parsePlan('1. delete everything', 'goal');
      expect(high.steps[0]?.risk).toBe('high');
    });

    it('extracts file paths from descriptions', () => {
      const input = '1. Edit `src/index.ts` and `config.json`';
      const plan = parsePlan(input, 'goal');
      expect(plan.steps[0]?.affectedFiles).toContain('src/index.ts');
      expect(plan.steps[0]?.affectedFiles).toContain('config.json');
    });

    it('filters short/invalid steps', () => {
      // Parser drops descriptions under 5 chars + empty lines. "foo"/"bar"
      // are too short; "3. " is empty after the prefix is stripped. Only
      // the two longer steps survive.
      const input = '1. read configuration file\n2. write output to disk\n3. \n4. x\n5. hi';
      const plan = parsePlan(input, 'goal');
      expect(plan.steps).toHaveLength(2);
    });
  });

  describe('formatPlanForDisplay', () => {
    it('formats plan with risk icons and file counts', () => {
      const plan: ExecutionPlan = {
        id: 'test',
        goal: 'test goal',
        steps: [
          { id: '1', description: 'step 1', risk: 'low' },
          { id: '2', description: 'edit `src/file.ts`', risk: 'medium', affectedFiles: ['src/file.ts'] }
        ],
        estimatedChangedFiles: 1,
        hasDestructiveSteps: false,
        createdAt: 'now'
      };
      const output = formatPlanForDisplay(plan);
      expect(output).toContain('🟢');
      expect(output).toContain('🟡');
      expect(output).toContain('**Files:** ~1');
    });
  });

  describe('PlanActController', () => {
    it('transitions phases correctly', () => {
      // PlanActPhase is a string-union type, not an enum — compare to
      // string literals directly. alwaysRequireApproval forces the
      // awaiting_approval phase even for empty plans.
      const controller = new PlanActController({ autoApproveThreshold: 0, alwaysRequireApproval: true });
      expect(controller.phase).toBe('planning');

      controller.setPlan({ id: 'p1', goal: 'g', steps: [], estimatedChangedFiles: 0, hasDestructiveSteps: false, createdAt: '' });
      expect(controller.phase).toBe('awaiting_approval');

      controller.processApproval('yes');
      expect(controller.phase).toBe('executing');
    });

    it('auto-approves low-risk plans', () => {
      const controller = new PlanActController({ autoApproveThreshold: 5 });
      controller.setPlan({ id: 'p1', goal: 'g', steps: [], estimatedChangedFiles: 2, hasDestructiveSteps: false, createdAt: '' });
      expect(controller.phase).toBe('executing'); // auto-approved
    });
  });
});
