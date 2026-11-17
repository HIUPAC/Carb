---
name: image-recognition
description: >-
  Inspect attached or pasted images, screenshots, scans, diagrams, and photos and
  turn them into reliable observations, OCR text, UI requirements, or structured
  data for any model. Use whenever a task includes an image or asks to imitate a
  visual reference.
---

# Image recognition

Treat every image attachment as task input. Start by checking the image dimensions,
orientation, crop, and whether it is a screenshot, document scan, diagram, photo, or
reference design. Describe what is visible before proposing changes. Separate direct
observations from inferences and mark unreadable text as `[unclear]` instead of
inventing it.

Use the host model's vision input first. If the host cannot inspect pixels, ask for a
usable image attachment or use an available local OCR/image tool; do not claim that
OCR succeeded without evidence. For screenshots, inventory layout regions, spacing,
typography, colors, borders, controls, states, and responsive behavior. For documents,
preserve reading order and table structure. For diagrams, list nodes, labels, arrows,
and relationships. For photos, describe only visible facts and avoid identifying
people or sensitive traits.

When the image is a design reference, produce an implementation brief with measurable
tokens (approximate colors, spacing, radii, border weights, type hierarchy) and a
short acceptance checklist. Keep the original image available to the user and cite
which observations came from it. Never silently upload an attachment to an external
service.
