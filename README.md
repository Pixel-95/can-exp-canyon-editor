# Canyon Route Editor

Minimal Electron desktop app (Windows + macOS) that uses Mapbox to set start/end points, generate a walking route, render it, and save the route as GeoJSON.

## Architecture

- `electron/main.ts`: creates the app window with secure defaults, resolves token from environment, and handles save dialog/file writes via IPC.
- `electron/preload.ts`: exposes a minimal safe API (`getMapboxToken`, `saveGeoJSON`) using `contextBridge`.
- `renderer/`: Vite + React + TypeScript UI with `mapbox-gl`, map click modes, route generation, and export controls.

## Prerequisites

- Node.js 20+
- npm 10+
- Mapbox account with access to the Directions API

## External setup steps (required)

1. Create a Mapbox account at `https://www.mapbox.com/`.
2. Create an access token:
   - In Mapbox dashboard, go to **Access tokens**.
   - Create a token with at least styles + directions access.
3. Ensure Directions API access:
   - Verify your account/plan allows Directions API calls.
   - If token restrictions are enabled, allow requests for your desktop app environment.
4. Put token into `.env` in project root:

```env
VITE_MAPBOX_TOKEN=your_mapbox_token_here
# or
MAPBOX_TOKEN=your_mapbox_token_here
```

Notes:
- `VITE_MAPBOX_TOKEN` is read directly by the renderer during development/build.
- `MAPBOX_TOKEN` is read by Electron main process (via preload bridge), useful for runtime-provided tokens.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts:
- Vite dev server (`http://localhost:5173`)
- Electron TypeScript watch build
- Electron app with auto-restart on main/preload changes

## Production build

```bash
npm run build
```

Outputs:
- Renderer: `dist/renderer`
- Electron main/preload: `dist/electron`

## Package installers (Windows + macOS)

```bash
npm run package
```

Installer outputs are written to `release/`.

Platform note:
- Build Windows installers on Windows.
- Build macOS DMG on macOS.

### macOS packaging note

For local unsigned builds you can still create a DMG, but Gatekeeper warnings are expected.
Optional: configure Apple signing/notarization env vars in `electron-builder` for production distribution.

## Token provisioning in production

Use `MAPBOX_TOKEN` as an environment variable before launching the packaged app, for example:

- Windows PowerShell:

```powershell
$env:MAPBOX_TOKEN="your_token_here"
./Canyon Route Editor.exe
```

- macOS shell:

```bash
MAPBOX_TOKEN="your_token_here" /Applications/Canyon\ Route\ Editor.app/Contents/MacOS/Canyon\ Route\ Editor
```

## GeoJSON export format

`Save GeoJSON` writes a valid `FeatureCollection` with one `LineString` feature and properties:

- `distance_m`
- `duration_s`
- `profile` (`"walking"`)
- `start` (`[lng, lat]`)
- `end` (`[lng, lat]`)
- `generated_at` (ISO timestamp)

## Assumptions

- App uses the first route returned by Mapbox Directions API.
- Coordinates are stored as `[longitude, latitude]`.
- Route generation requires an active internet connection.

## Next steps

- Add waypoint support (multi-stop routing).
- Add a "straight line" mode that exports `[start, end]` as a `LineString` without Directions API.
- Load and attach saved routes to a larger JSON dataset/workflow.
