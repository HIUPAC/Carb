---
name: workbuddy-agent
description: >-
  Prepare tasks for Tencent WorkBuddy when the user selects it as a coding agent.
  Keep the adapter configurable and disclose whether a local WorkBuddy ACP/CLI has
  been installed and verified.
---

# Tencent WorkBuddy adapter

WorkBuddy and CodeBuddy are separate Tencent products. Do not silently route a
WorkBuddy request to the existing CodeBuddy adapter. If the user selects WorkBuddy,
show a provider entry with the proposed ACP command `workbuddy --acp` only when that
command is configured, then probe the executable and report the result.

The public WorkBuddy site does not by itself verify a coding ACP protocol. Therefore
keep the integration disabled until a local executable, protocol version, and
authentication method are confirmed. Store credentials through the app provider
settings, never in a skill file or prompt. If the probe fails, offer the existing
verified providers and let the user continue with a normal model.

When an adapter is available, pass the repository path, user request, selected model
settings, and cancellation signal through the provider contract. Preserve streamed
text and tool events, enforce workspace boundaries, and surface provider errors with
the exact command and remediation without exposing secrets.
