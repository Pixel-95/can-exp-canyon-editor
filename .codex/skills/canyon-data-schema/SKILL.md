---
name: canyon-data-schema
description: Validate and maintain canyon JSON plus linked track GeoJSON integrity. Use when changing sections, track links, track files, or save/load data structure.
metadata:
  short-description: Guard data model integrity for canyon JSON and tracks
---

# Canyon Data Schema

Use this skill for any task that changes canyon data structure or track persistence.

## Read First

1. `PROJECT_CONTEXT.md`
2. `PROJECT_CONVENTIONS.md`

## Responsibilities

1. Keep `data.json` structure valid for the editor.
2. Keep section-to-track links and access track links coherent.
3. Ensure track files remain valid GeoJSON for editor round-trips.
4. Protect deterministic naming and collision handling behavior.
5. Preserve backward compatibility when feasible.

## Core Checks

1. Every section should have exactly one `track_canyon` link.
2. `tracks_access[]` should contain normalized track links only.
3. Track payload should remain a `FeatureCollection` with one `LineString`.
4. Editor metadata properties needed for reconstruction should not be dropped.
5. `tour_dimensions_in_meter` should remain present in saved section JSON.

## Boundaries

1. Do not redesign UI behavior unless required by data constraints.
2. Do not introduce destructive cleanup of unrelated files by default.
3. Keep migrations incremental and reversible when possible.

## Output Contract

Return:

1. Data invariants touched
2. Files changed
3. Validation performed
4. Migration/compatibility notes
