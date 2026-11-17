---
name: request-optimizer
description: >-
  Rewrite a user's draft request into a clearer, more professional, actionable
  prompt while preserving intent, constraints, language, and tone. Use for the
  composer's Optimize button; never send the rewritten request automatically.
---

# Request optimizer

The Optimize action is a user-controlled editing aid. Read the draft only from the
composer, classify its task type, and produce a revised draft beside the original.
Keep the user's objective, files, references, deadlines, language, and explicit
constraints. Add missing structure only when it can be inferred safely. Do not invent
requirements, credentials, integrations, acceptance criteria, or facts.

Use this compact structure when it helps: **Goal**, **Context and inputs**, **Desired
output**, **Constraints**, **Acceptance checks**, and **Open questions**. Keep the
rewrite proportional to the draft and preserve Chinese or other source language.
Highlight material additions or assumptions. Let the user edit, discard, or apply the
result; applying it must only replace the composer text. The app sends the request
only after the user presses the normal Send control.
