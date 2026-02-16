# Decisions

## 2026-02-16: Behavior-Preserving Refactor Strategy

1. Preserve all runtime behavior and storage contracts.
2. Prefer extraction of pure/helper code over algorithm changes.
3. Keep IPC channel names and payload shapes stable.
4. Add stronger static checks (`typecheck`) and lightweight unit tests for pure utilities.
5. Use incremental module extraction in high-churn files (`RouteMapApp.tsx`, `CanyonJsonEditor.tsx`, `electron/main.ts`) while keeping integration points unchanged.

## 2026-02-16: Shared Utility Consolidation

1. Renderer shared helpers moved into `renderer/src/shared/*` for coordinate, error, and track-link helpers.
2. Electron IPC payload types centralized in `electron/ipcTypes.ts`.
3. Electron pure/path helpers centralized in `electron/mainUtils.ts`.

## 2026-02-16: Tokenized Premium UI Redesign (No Behavior Change)

1. Adopted a token-based visual system with Inter self-hosted typography.
2. Split renderer styles into focused modules:
   `tokens.css`, `base.css`, `layout.css`, `components.css`, `map.css`, `json-editor.css`.
3. Preserved all feature behavior and contracts:
   no map/edit/save/load/data model changes.
4. Route semantic colors remain unchanged:
   section `#FF0000`, access `#000000` (`#FFFFFF` in satellite).

## 2026-02-16: Clarity-First IA Redesign v2 (No Behavior Change)

1. Adopted a three-zone editor workspace:
   scope rail, content column, and map column/overlay.
2. Prioritized one-glance ownership clarity:
   file actions vs map actions vs JSON content zones.
3. Kept all existing behavior, IPC contracts, and data formats unchanged.
4. Added workflow skills for repeatable UI quality gates:
   `ia-ux-architect`, `responsive-layout-specialist`, `accessibility-reviewer`.
5. Set responsive verification baseline to
   `1280x800`, `1366x768`, `1920x1080`, `2560x1440`.
