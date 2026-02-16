# Multi-Agent Workflow

This repo uses four Codex skills for role-based work in a single chat.

## Agents

1. `planner` (`$planner`)
   Responsibility: define scope, sequence, risks, and validation plan.
2. `designer` (`$designer`)
   Responsibility: define the UI visual system and interaction style.
3. `implementer` (`$implementer`)
   Responsibility: implement approved plan and design decisions, then run checks.
4. `reviewer` (`$reviewer`)
   Responsibility: findings-first review for bugs, regressions, and test gaps.

## Invocation

Use one chat and switch role by naming the skill in your prompt.

1. Planning: `Use $planner for <task>`
2. Design: `Use $designer to define UI system and interaction rules`
3. Implementation: `Use $implementer to execute the approved plan and design spec`
4. Review: `Use $reviewer on the latest changes`

## Collaboration Contract

1. Start with `$planner` for non-trivial work.
2. For UI or UX work, run `$designer` after planning and before implementation.
3. Execute with `$implementer` only after plan approval and design direction are clear.
4. Gate with `$reviewer` before final acceptance.
5. If reviewer finds issues:
   Return to `$implementer` for fixes.
6. If issues require design changes:
   Return to `$designer`, then `$implementer`, then re-run `$reviewer`.

## Skill Locations

1. `.codex/skills/planner`
2. `.codex/skills/designer`
3. `.codex/skills/implementer`
4. `.codex/skills/reviewer`

## Project Skills

Use these when tasks are domain-specific:

1. `canyon-data-schema` (`$canyon-data-schema`)
   For `data.json` structure, track links, GeoJSON integrity, save/load data rules.
2. `map-editor-behavior` (`$map-editor-behavior`)
   For map interaction logic, active-track editing behavior, marker and route UX.
3. `electron-ipc-contracts` (`$electron-ipc-contracts`)
   For IPC channel and payload changes across main/preload/renderer types.

## Project Reference Docs

1. `PROJECT_CONTEXT.md`
2. `PROJECT_CONVENTIONS.md`

## Maintenance Guard

Run docs-sync checks when finishing changes:

1. `npm run check:context-sync`
2. `npm run check:context-sync:staged`
3. CI also enforces this in `.github/workflows/context-sync.yml`.
