---
name: Sample Refactor Skill
description: Refactor a TypeScript module without changing behavior.
tools:
  - read_file
  - edit_file
  - run_tests
---

Use this skill when a TypeScript module needs cleanup without changing the public behavior.

1. Read the target file and nearby tests before changing anything.
2. Keep behavior intact while improving structure, naming, or clarity.
3. Run the relevant tests after the change and summarize the outcome.
4. Call out any follow-up risks instead of hiding them.
