# Project Conventions

## Scope

These conventions apply to all changes in this repository.
Use this file together with `PROJECT_CONTEXT.md`.

## Data and File Conventions

1. Track links in JSON must be project-relative and normalized with `/`.
2. Track links must point into `./tracks/`.
3. Section tracks are linked through `sections[i].track_canyon`.
4. Access tracks are linked through `tracks_access[]`.
5. Track files must be GeoJSON `FeatureCollection` with one `LineString`.
6. Do not auto-delete orphaned old track files during rename/relocation.

## Naming Conventions

1. Section track filenames are generated from sanitized section names.
2. If section names collide after sanitization, deterministic suffixing is required.
3. Access tracks use deterministic `access_XX.json` style naming.
4. Filenames must be safe on Windows and macOS.

## Editing Conventions

1. Only one active track is editable at a time.
2. Non-active tracks stay visible but non-interactive.
3. Overview point, POIs, and parking lots are global canyon entities.
4. Do not break existing editing interactions when extending behavior.
5. If no track is active, track-edit actions must no-op safely.
6. Map search must be non-blocking and must not intercept map interaction outside search controls.
7. Plain left-click on the map canvas should exit edit mode (view mode only).
8. Toggling map size (maximize/minimize) should reset to view mode (no active edit track).
9. In expanded mode, clicking a visible route line should set that route to edit mode.

## Visual Conventions

1. Section tracks use red `#FF0000`.
2. Access tracks use black `#000000`.
3. Keep UI minimal and readable; avoid decorative visual noise.
4. Preserve established interaction patterns unless explicitly changed.
5. Floating map overlays should be lightweight and centered only when contextually needed.

## Persistence Conventions

1. `Save canyon` is the source-of-truth save action.
2. Save must persist both:
   updated `data.json` and all track files.
3. Missing referenced track files should generate warnings and be recoverable on save.
4. Save must avoid accidental overwrite collisions.

## Derived Section Dimensions

`tour_dimensions_in_meter` remains in output JSON and is derived from section route data:

1. `elevation_start`:
   elevation of section route start.
2. `elevation_exit`:
   elevation of section route end.
3. `horizontal_length`:
   section route distance in meters.

## IPC Contract Conventions

When changing payloads or channels:

1. Keep channel names aligned between renderer and main.
2. Mirror type changes in:
   `electron/main.ts`, `electron/preload.ts`, `renderer/src/vite-env.d.ts`.
3. Keep filesystem/path logic in main process, not renderer.

## Validation Conventions

Before finishing substantial changes:

1. Run `npm run build`.
2. If behavior changes are UI-heavy, also run `npm run dev` and do manual checks.
3. Include validation outcome in handoff/summary.

## Documentation Sync Guard

To keep project context and workflow docs current:

1. Run `npm run check:context-sync` for all local changes.
2. Run `npm run check:context-sync:staged` before committing staged changes.
3. Guard rules:
   Core project code changes require `PROJECT_CONTEXT.md` or `PROJECT_CONVENTIONS.md` updates.
4. Guard rules:
   Changes under `.codex/skills/` require an `AGENTS.md` update.
5. Emergency bypass (one-off only):
   `SKIP_CONTEXT_SYNC=1 npm run check:context-sync`.
6. CI enforcement:
   `.github/workflows/context-sync.yml` runs this check on push and pull requests.
