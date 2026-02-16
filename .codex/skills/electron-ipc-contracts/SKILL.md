---
name: electron-ipc-contracts
description: Maintain consistency of IPC channels and payload types across Electron main, preload, and renderer typings.
metadata:
  short-description: Keep Electron IPC contracts synchronized and safe
---

# Electron IPC Contracts

Use this skill for any IPC channel or payload change.

## Read First

1. `PROJECT_CONTEXT.md`
2. `PROJECT_CONVENTIONS.md`
3. `electron/main.ts`
4. `electron/preload.ts`
5. `renderer/src/vite-env.d.ts`

## Responsibilities

1. Keep IPC channel names consistent across layers.
2. Keep request/response payload types synchronized.
3. Keep path and filesystem operations in main process only.
4. Preserve backward compatibility for existing flows where practical.
5. Ensure renderer API surface remains typed and explicit.

## Core Checks

1. Channel exists in main and is exposed in preload when needed.
2. Renderer type declarations match preload/main payload structure.
3. Save/load orchestration uses the expected request fields.
4. Error and canceled flows remain explicit and stable.

## Boundaries

1. Do not move business logic into renderer when it belongs in main.
2. Avoid ad-hoc `any` payloads for contract surfaces.
3. Avoid silent contract drift between files.

## Output Contract

Return:

1. Channels touched
2. Type definitions updated
3. Compatibility notes
4. Validation command results
