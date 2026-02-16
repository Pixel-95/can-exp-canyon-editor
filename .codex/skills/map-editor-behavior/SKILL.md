---
name: map-editor-behavior
description: Safely modify map editing behavior in RouteMapApp while preserving active-track isolation and existing interactions.
metadata:
  short-description: Guard map UX and editing invariants in RouteMapApp
---

# Map Editor Behavior

Use this skill when changing map UX, track interaction, markers, or route editing logic.

## Read First

1. `PROJECT_CONTEXT.md`
2. `PROJECT_CONVENTIONS.md`
3. `renderer/src/RouteMapApp.tsx`
4. `renderer/src/styles.css`

## Responsibilities

1. Preserve active-track-only editing model.
2. Keep non-active tracks visible and non-interactive.
3. Preserve POI/parking/overview behaviors as canyon-global.
4. Keep keyboard/context/drag/reorder editing behavior stable unless explicitly changed.
5. Keep map load/open viewport behavior coherent with available geometry and points.

## Core Checks

1. Active track selection and deactivation rules remain consistent.
2. Route generation still updates route summary and persisted track snapshot correctly.
3. Marker visibility and interactivity match active/inactive rules.
4. Track list operations still map correctly to track store state.
5. No regressions in compact vs expanded map modes.

## Boundaries

1. Avoid unrelated refactors in map code.
2. Keep style changes minimal unless a design task requested otherwise.
3. Preserve existing data persistence paths.

## Output Contract

Return:

1. Interaction behaviors changed
2. Invariants preserved
3. Files changed
4. Manual test checklist run
