# Folio 1.0.12-beta.8

Linux manual-install beta for the multi-workspace file mutation correction.
The paired AgentsServer source deployment uses the same version.

## Changes

- Restore Rename and Delete for files and folders in configured multi-root
  projects.
- Keep revision-conflict and existing-destination protection for absolute
  workspace mutations.
- Route local and SSH-backed project roots through the server-advertised
  workspace-files capability version 11.

## Validation

- 75 focused AgentsServer workspace tests passed.
- Relevant Electron renderer, IPC, client and service tests passed, together
  with TypeScript type checking and the production compile.
- A production Electron app connected to an isolated real AgentsServer, opened
  two project roots, renamed a file in the second root and deleted it. Both UI
  state and the actual filesystem result were checked.
- The Linux x64 AppImage and tar archive and the server npm-layout archive are
  checksum-verified after packaging.

## Distribution limits

- This prerelease contains Linux x64 desktop packages and a server source
  archive for manual installation. It is not a signed canonical AgentsDock
  coordinated update and does not replace the canonical macOS, Windows or
  Linux update feeds.
- macOS, Windows, Linux arm64, mobile and live SSH-backed UI mutation acceptance
  are not included in this release.
- The full Electron sweep has three unrelated existing failures: two runtime
  catalog call-count expectations and one split-pane control query. The changed
  workflow's focused suites and real-app acceptance pass.
