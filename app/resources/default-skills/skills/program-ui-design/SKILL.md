---
name: program-ui-design
description: >-
  Design or implement application interfaces from a brief or visual reference.
  Use for desktop, web, and mobile UI work, including dark themes, panels, forms,
  navigation, and interaction states.
---

# Program UI design

Before implementation, ask the app UI intake questions shown by the product:
target platform and viewport, primary user and task, required screens/states, data
and actions, accessibility constraints, and whether the reference is binding or only
inspirational. If a screenshot is supplied, inspect it with `image-recognition` and
summarize the visual tokens before coding.

Prefer a small token system for color, type, spacing, radius, elevation, and motion.
For a dark reference, use near-black surfaces, restrained contrast, thin borders,
comfortable section spacing, and visible focus/hover/disabled states. Build the
layout from semantic regions and reusable components; do not hard-code a single
viewport. Preserve keyboard access, readable contrast, reduced-motion behavior, and
clear empty/loading/error states.

Validate the result at the target viewport and one narrower/wider viewport. Compare
the implementation against the reference using a checklist of alignment, spacing,
border treatment, hierarchy, and interaction feedback. Explain intentional deviations
when the reference conflicts with usability or accessibility.
