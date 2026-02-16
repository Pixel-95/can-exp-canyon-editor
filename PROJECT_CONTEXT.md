# Project Context

## Purpose

`can-exp-canyon-editor` is a desktop editor for canyon content used by Canyon Explore.
It edits one canyon JSON payload plus linked track GeoJSON files.

## Tech Stack

1. Electron main process (`electron/main.ts`)
2. Electron preload bridge (`electron/preload.ts`)
3. React + TypeScript renderer (`renderer/src/*`)
4. Map rendering and routing with Mapbox GL (`renderer/src/RouteMapApp.tsx`)

## Repository Structure

1. `renderer/src/CanyonJsonEditor.tsx`
   Main JSON form editor and save/load orchestration.
2. `renderer/src/RouteMapApp.tsx`
   Map UI, track editing, POI/parking/overview editing.
3. `renderer/src/styles.css`
   UI and map overlay styling.
4. `electron/main.ts`
   File I/O, IPC handlers, path resolution, track persistence.
5. `electron/preload.ts`
   Typed `window.api` bridge.
6. `renderer/src/vite-env.d.ts`
   Renderer-side IPC typings.
7. `data/*`
   Canyon data folders (`data.json`, `tracks/*.json`, `topos/*`).

## Runtime Model

1. Renderer reads/writes via `window.api`.
2. Main process owns filesystem access and path normalization.
3. Renderer holds in-memory edit state and emits a track snapshot on changes.
4. Save writes both:
   `data.json` + all referenced track GeoJSON files.

## Canyon Data Model (High-Level)

Core root keys used by editor:

1. `name`
2. `description`
3. `location`
4. `coordinates` (overview point)
5. `parking_lots`
6. `points_of_interest`
7. `sections`
8. `tracks_access`

Section keys relevant to map/track flow:

1. `id`
2. `name`
3. `track_canyon` (path to section track)
4. `tour_dimensions_in_meter`

## Track System

1. Section tracks:
   One per section, linked from `sections[i].track_canyon`.
2. Access tracks:
   Multiple tracks linked from `tracks_access[]`.
3. Track files:
   GeoJSON `FeatureCollection` with one `LineString` feature.
4. Editor properties used for reconstruction:
   `start`, `end`, `waypoints`, `segments`, `distance_m`, `duration_s`,
   `elevation_gain_m`, `elevation_start_m`, `elevation_end_m`, `generated_at`.

## Editing Behavior

1. All tracks are displayed simultaneously.
2. Only active track is editable.
3. Overview point, POIs, and parking lots are canyon-global.
4. Save action is canyon-level:
   it persists `data.json` and all tracks together.
5. Map includes a floating location search overlay:
   submit query -> geocode -> smooth pan/zoom to best match.

## Save/Load Flow

Load:

1. `CanyonJsonEditor` loads JSON.
2. Builds `TrackBindings` from sections + access links.
3. `RouteMapApp` loads track files via `tracks:load-batch`.

Save:

1. Renderer sends `saveCanyonWithTracks` with `canyonData` + `trackSnapshot`.
2. Main resolves save target and ensures `tracks` directory exists.
3. Main computes deterministic section/access filenames.
4. Main writes all track files and updates links in JSON.
5. Main writes updated `data.json`.

## Current Core IPC Channels

1. `config:get-mapbox-token`
2. `json:load-dialog`
3. `json:load-path`
4. `json:new-template`
5. `json:create-canyon-folder`
6. `json:save`
7. `tracks:load-batch`
8. `json:save-with-tracks`
9. `json:pick-file`

## Build and Run

1. Dev: `npm run dev`
2. Build: `npm run build`
3. Package: `npm run package`
