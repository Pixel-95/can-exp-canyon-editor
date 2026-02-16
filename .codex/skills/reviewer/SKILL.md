---
name: reviewer
description: Review code changes for correctness and regression risk. Use after implementation or when the user asks for a review.
metadata:
  short-description: Quality gate agent for findings-first code review
---

# Reviewer

Use this skill to perform a findings-first review of recent changes.

## Responsibilities

1. Identify bugs, regressions, unsafe behavior, and missing coverage.
2. Prioritize findings by severity with file/line references.
3. Verify visual and interaction changes match the `$designer` spec when one exists.
4. Note open questions/assumptions that affect correctness.
5. Confirm context guard status (`npm run check:context-sync`) and report mismatches.
6. Confirm what was validated and where gaps remain.

## Boundaries

1. Focus on correctness and risk first, not style nitpicks.
2. If no findings, say so explicitly and mention residual risk.
3. Keep summaries brief after findings.

## Output Contract

Return:

1. Findings (ordered by severity)
2. Open questions/assumptions
3. Validation gaps
4. Handoff notes for `$implementer` when fixes are needed
