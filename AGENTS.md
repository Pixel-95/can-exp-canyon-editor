# Multi-Agent Workflow

This repo uses role-based Codex skills in one chat window.

## Core Agents

1. `planner` (`$planner`)
   Responsibility: define scope, sequence, risks, and validation gates.
2. `ia-ux-architect` (`$ia-ux-architect`)
   Responsibility: define grouping, navigation, and scan-first layout/IA.
3. `designer` (`$designer`)
   Responsibility: define visual system tokens and component interaction rules.
4. `implementer` (`$implementer`)
   Responsibility: implement approved plan/design with behavior-preserving changes.
5. `responsive-layout-specialist` (`$responsive-layout-specialist`)
   Responsibility: tune breakpoints, overflow, and readable widths.
6. `accessibility-reviewer` (`$accessibility-reviewer`)
   Responsibility: check focus, keyboard reachability, labels, and practical contrast.
7. `reviewer` (`$reviewer`)
   Responsibility: findings-first regression review and risk callout.

## Invocation Examples

1. Planning:
   `Use $planner for <task>`
2. IA:
   `Use $ia-ux-architect to propose grouping and navigation`
3. Visual design:
   `Use $designer to define tokens and component rules`
4. Implementation:
   `Use $implementer to apply the approved IA/design without behavior changes`
5. Responsive pass:
   `Use $responsive-layout-specialist to tune breakpoints and widths`
6. Accessibility pass:
   `Use $accessibility-reviewer on the latest UI changes`
7. Final review:
   `Use $reviewer on the latest changes`

## Collaboration Order

Use this order for non-trivial UI work:

1. `$planner`
2. `$ia-ux-architect`
3. `$designer`
4. `$implementer`
5. `$responsive-layout-specialist`
6. `$accessibility-reviewer`
7. `$reviewer`

If reviewer finds issues:

1. Return to `$implementer` for fixes.
2. Re-run `$responsive-layout-specialist` and `$accessibility-reviewer` when affected.
3. Re-run `$reviewer` for final gate.

## Skill Locations

1. `.codex/skills/planner`
2. `.codex/skills/ia-ux-architect`
3. `.codex/skills/designer`
4. `.codex/skills/implementer`
5. `.codex/skills/responsive-layout-specialist`
6. `.codex/skills/accessibility-reviewer`
7. `.codex/skills/reviewer`

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
