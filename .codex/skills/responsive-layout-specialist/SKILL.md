---
name: responsive-layout-specialist
description: Tune responsive behavior and readable widths without changing functionality. Use when redesigning layouts that must work on small screens and large monitors with zero clipped controls.
---

# Responsive Layout Specialist

Use this skill after implementation changes and before final review.

## Responsibilities

1. Define breakpoint behavior for layout zones and scrolling.
2. Prevent clipping, overflow, and unreachable controls.
3. Preserve readable line lengths on large screens.
4. Keep map overlays and side panels usable across viewport sizes.
5. Keep functionality and control semantics unchanged.

## Workflow

1. Verify baseline breakpoints:
   `1280x800`, `1366x768`, `1920x1080`, `2560x1440`.
2. Check map/editor split for clipped controls or unusable scroll regions.
3. Apply max-width constraints to semantically narrow fields.
4. Ensure long text areas keep readable width.
5. Produce targeted CSS adjustments only.

## Output Contract

Return:

1. Breakpoint matrix with expected behavior.
2. Specific overflow/clipping findings.
3. Minimal CSS fixes by file/class.
4. Residual responsive risks to re-check.
