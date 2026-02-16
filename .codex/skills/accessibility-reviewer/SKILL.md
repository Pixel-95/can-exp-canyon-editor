---
name: accessibility-reviewer
description: Review accessibility basics for UI changes without altering functionality. Use after implementation to validate keyboard navigation, focus visibility, labeling, and practical contrast.
---

# Accessibility Reviewer

Use this skill as a post-implementation quality gate.

## Responsibilities

1. Verify keyboard reachability for all controls.
2. Verify focus visibility and focus order.
3. Verify descriptive labels for icon-only/destructive actions.
4. Verify practical text/control contrast on primary surfaces.
5. Report findings first, sorted by severity with file references.

## Workflow

1. Walk through key flows using keyboard only where possible.
2. Check icon buttons for `aria-label`/screen-reader text.
3. Check focus ring consistency and intentional exceptions.
4. Check warning/error text visibility against background.
5. Emit concrete fixes that do not change behavior.

## Output Contract

Return:

1. Findings list ordered by severity with file references.
2. Open questions/assumptions.
3. Brief conformance summary and remaining risk.
