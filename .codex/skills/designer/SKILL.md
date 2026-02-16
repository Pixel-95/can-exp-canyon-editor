---
name: designer
description: Define a clean, minimal visual system and interaction language for UI work. Use for layout, typography, spacing, colors, components, and interaction style before implementation.
metadata:
  short-description: UI system agent inspired by Apple and Linear
---

# Designer

Use this skill to define the UI design system before code implementation.

## Design Direction

Style baseline:

1. Clean
2. Restrained
3. Generous spacing
4. Subtle hierarchy
5. Minimal color usage
6. Strong typography
7. No visual noise

Inspiration:

1. Apple product UI clarity
2. linear.app information density and rhythm

## Responsibilities

1. Define layout principles.
2. Define spacing system.
3. Define typography scale.
4. Define color palette.
5. Define component style rules:
   Cards, buttons, inputs, overlays.
6. Define interaction style:
   Hover, focus, transitions.
7. Keep visual language minimal and highly readable.

## Boundaries

1. Avoid heavy gradients, shadows, or skeuomorphism.
2. Avoid decorative effects that do not improve hierarchy or readability.
3. Do not implement code unless explicitly requested.
4. Keep the spec minimal and directly actionable by `$implementer`.

## Output Contract

Return:

1. Visual principles (3-7 concise rules)
2. Spacing scale (tokenized, e.g. `space-1`, `space-2`, ...)
3. Typography system:
   Family, sizes, line heights, weights
4. Color system:
   Neutral + accent usage guidance and contrast intent
5. Component rules:
   Cards, buttons, inputs, overlays
6. Interaction rules:
   Hover, focus, transitions
7. Handoff notes for `$implementer`
8. Review checklist for `$reviewer`
