<p align="center">
  <span style="display:inline-flex;width:120px;height:120px;align-items:center;justify-content:center;background:#1f1f1f;border-radius:22px;">
    <img src="build/icon.png" alt="Canyon Explore Canyon Editor icon" width="96" height="96" />
  </span>
</p>

<h1 align="center">Canyon Explore - Canyon Editor</h1>

<p align="center">
  A desktop canyon editor to introduce and maintain new canyons for the Canyon Explore app.
</p>

<p align="center">
  <a href="https://canyon-explore.com/"><strong>Website 🔗</strong></a>
</p>

<p align="center">
  <img src="screenshot.png" alt="Screenshot of the Canyon Editor interface" />
</p>

## Overview
With Canyon Editor, new canyons can be introduced for Canyon Explore in a structured way.  
Create routes with start, waypoint, and end points on the map, then export the canyon data for app integration.

## Why It Stands Out
- Built specifically for adding canyon content to Canyon Explore
- Fast, map-based editing of ordered route points
- Clean export format for integration into existing workflows
- Desktop app workflow for Windows and macOS

## Commands
Run in development
`npm run dev`

Build Windows portable executable
`npm run package:win`
`npm run package:dist`

Build macOS app directory artifact (compatible with macOS 10.15 Catalina and newer)
`npm run package:mac`
`npm run package:dist`

Build macOS ZIP artifact (Catalina compatible)
`npm run package:mac:zip`
`npm run package:dist`

Compatibility note:
- This project is pinned to Electron 32.x so the app can run on macOS 10.15.6.
- macOS packaging is forced to `x64` for Catalina support (`arm64` requires macOS 11+).

## Build and Run macOS Artifact
GitHub workflow file:
`.github/workflows/build-macos.yml`

1. Commit and push your changes (including the workflow file) to GitHub.
2. In GitHub, open `Actions` -> `Build macOS Distribution`.
3. Click `Run workflow` and select your branch.
4. Wait until the run is green (workflow verifies `x86_64` arch and `LSMinimumSystemVersion=10.15.0`).
5. Download artifact `canyon-editor-macos` from the Artifacts section.

GitHub downloads the artifact as a ZIP file. Inside that ZIP you will find `canyon-editor-macos.tar.gz`, which contains:
- `macos/Canyon Editor.app`
- `macos/assets/`
- `macos/data/`

Run these commands on the Mac in Terminal:

```bash
cd ~/Downloads
unzip canyon-editor-macos.zip
tar -xzf canyon-editor-macos.tar.gz
xattr -dr com.apple.quarantine "macos"
```
Copy the env file into the assets folder. Then navigate into the assets folder via `cd ...` and rename the env file via
```bash
mv env .env
```
Start the application (if Mac does not trust the Developer, open via right click -> open)

Notes:
- If your browser downloaded the artifact with a different filename, replace `canyon-editor-macos.zip` with the actual ZIP filename.
- The `xattr -dr com.apple.quarantine "macos"` command is important. Without it, macOS may launch the app through AppTranslocation and the sibling `macos/data/` folder will not work correctly.
- The `cp env "macos/assets/env"` command assumes your token file is named `env` and is in `~/Downloads`. If it is somewhere else, replace `env` with the real path to that file.
- After the `mv` command, the app will read the token from `macos/assets/.env`.
- New canyons will be saved into `macos/data/` next to the app.

If you do not already have an `env` file, create `macos/assets/.env` manually with:

```env
VITE_MAPBOX_TOKEN=your_mapbox_token_here
MAPBOX_TOKEN=your_mapbox_token_here
```
