---
name: trae-programming
description: >-
  Apply a Trae-style programming workflow: understand the repository, plan a small
  change, implement with context, run focused checks, and report evidence. This is a
  prompt/workflow skill and does not install or impersonate the Trae product.
---

# Trae programming workflow

Use a repository-first loop: inspect instructions and the relevant files, restate the
goal as concrete behavior, identify dependencies and risks, make the smallest
coherent change, run focused validation, then summarize changed files and evidence.
Keep the user in control of irreversible actions such as publishing, deleting data,
or merging.

Use existing project conventions and package scripts. Prefer readable, localized
changes over broad generated rewrites. When requirements are ambiguous, make safe
progress on independent parts and ask one targeted question for the blocking choice.
For UI work, include a visual check; for APIs, include a request/response or schema
check; for documents, render and inspect the output. State failures and unverified
external dependencies plainly.

This skill does not claim that a `trae` or `trae-cli` executable is installed. If a
user requests the actual Trae service, present the configured provider options and
ask them to install or authorize a supported adapter.
