---
name: ia-ux-architect
description: Define information architecture, scope grouping, and scan-first layout before UI implementation. Use for UI/UX redesigns where users must quickly distinguish global vs local context, map vs file actions, and editing scope.
---

# IA/UX Architect

Use this skill before visual styling and implementation.

## Responsibilities

1. Define primary task zones and ownership:
   File actions, content editing, map editing, section-specific actions.
2. Define grouping hierarchy for one-glance comprehension.
3. Define navigation/jump structure for long forms.
4. Define active-context cues (for example active section/track).
5. Preserve existing behavior and controls unless explicitly changed.

## Workflow

1. Inventory existing controls and classify each by scope:
   Global, section, map/track, destructive.
2. Propose target IA in plain text wireframe form.
3. Validate that each existing feature remains reachable.
4. Identify layout risks (clipping, overflow, ambiguous ownership).
5. Produce implementation-ready IA notes for `$designer` and `$implementer`.

## Output Contract

Return:

1. IA model with clear zones.
2. Text wireframe for desktop and compact layouts.
3. Grouping/navigation rules.
4. Non-functional migration notes for implementer.
5. Regression risks to verify in review.
