# Carb Windows maintenance

Carb 5.6.14 desktop stability sources are in the application snapshot. Run npm run check:stability to verify the renderer and local core supervisor. The original build workflow below targets the older baseline.

For installation, first use, modules, data handling, and licensing, see the [Chinese product README](../README.md). This file describes the original local maintenance workspace. The GitHub repository includes its tools and overlays; the external baseline and verification runtimes still require separate preparation, as described in [BUILD.md](../docs/BUILD.md).

This staging lane creates Carb from the `Test-0.5.11-ux-enhancements` package and the current overlays in `overlay/asar` and `overlay/resources`. The base package retains the existing mouse glow, card press response, and damped page transitions.

Run these commands from `D:\TasteCode` after the overlays are ready:

```powershell
node .\carb-work\tools\stage-carb.mjs
node .\carb-work\tools\verify-carb-payload.mjs
node .\carb-work\tools\verify-artifact-workflow.mjs
node .\carb-work\tools\verify-release-artifacts.mjs
& .\carb-work\tools\Build-Carb.ps1
```

The stage writes `carb-work\Carb-5.6.13`; the unsigned installer and its manifest are written to `安装包\Carb-Setup-5.6.13-win-x64.exe`. `stage-carb.mjs --refresh` moves the previous payload into `carb-work\verification\payload-backups` before rebuilding. The installer build refuses to overwrite an existing installer.

Settings → 联系我们 opens `https://houpac.top/` in the system browser through the desktop shell's external-link bridge.

Settings → 检查更新 opens `https://github.com/HIUPAC/Carb/releases` in the system browser so users can view and download the latest release.

Codex readiness is based on its standalone CLI. The desktop application is detected separately; its GUI, private CLI, and daemon do not satisfy CLI installation. Detection, version checks, sessions, login, and updates share the selected CLI path. Existing CLI installations skip repeat installation. Command terminals retain readable dimensions while hidden, and installation failures return a concise error and nonzero exit code.

Signed-in Codex account status retains its email and plan component alongside the CLI installation label. Settings supports both plain-text status and account components without treating account components as strings.

The current skill installer supports only local ZIP archives and local skill folders. It does not accept GitHub URLs or fetch remote repositories. It previews the discovered skills and metadata before global installation, lets the user select a subset, blocks duplicate names, snapshots and validates archives, and rolls back a failed batch. The Find Skill link opens an external page; download the skill locally before importing it. The document workflow reports a real file readback and SHA-256 receipt, while the theme bridge maps extension controls to the live light/dark palette. Settings includes Chinese font presets backed by local system fonts, with separate light and dark preferences.

Provider OAuth links are opened through the desktop shell's validated external-link bridge; if the browser launch fails, the sign-in URL can be copied directly from the sign-in panel. Renderer recovery automatically reloads one isolated crash and resets its recovery budget after a 30-second stable load, while repeated crashes remain visible for diagnosis. Run `node .\carb-work\tools\verify-login-renderer-recovery.mjs` from `D:\TasteCode` to verify these behaviors without performing a real sign-in.

Carb uses `Icewheel.Carb` as its Windows application ID, the display name `冰轮` as publisher, `%APPDATA%\CarbData` for its default desktop data profile, and `~/.carb` for product configuration. It does not import or move data from Test or another product. Shared `@harness/*` packages and upstream attribution remain intact; their source namespaces are compatibility identifiers.
