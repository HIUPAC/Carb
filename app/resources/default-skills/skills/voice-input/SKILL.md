---
name: voice-input
description: >-
  Help users dictate requests and turn speech transcripts into clean prompts. Use
  the app voice control when available, preserve the user's intent, and handle
  uncertain words explicitly.
---

# Voice input

The composer voice control records microphone input and sends it through the app's
`voice.transcribe` service. Use that control instead of asking the user to install a
separate recorder. Explain microphone permission the first time it is needed and
offer cancel/stop when recording is active.

Treat a transcript as a draft. Keep names, file paths, code identifiers, numbers, and
negative instructions exactly when confidence is good. Mark uncertain spans with a
question or ask one focused clarification before acting. Apply the request optimizer
only after the transcript is visible, so the user can edit both the raw transcript
and the proposed rewrite. Never send audio to a third party unless the user has
explicitly configured and authorized that provider.
