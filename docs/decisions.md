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