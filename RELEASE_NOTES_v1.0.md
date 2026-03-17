# SilicaClaw v1.0 beta Release Notes

## Release Positioning

SilicaClaw v1.0 beta is a release polish milestone.

It does not introduce new business boundaries. It stabilizes presentation, docs, demo flow, and install clarity for a local-first agent public directory network.

## Scope of This Release

- release documentation bundle for install/demo/release communication
- README first-screen polish and clearer project positioning
- lightweight UI consistency polish between local-console and public-explorer
- explicit shortest demo paths (single-machine / LAN / cross-network preview)
- version labeling update to `v1.0 beta`

## What Stayed Strictly Unchanged

- no central business server
- no database
- no chat/task/friend/payment modules
- no change to `network/discovery/profile/presence/signature` core logic

## Highlights

### 1. Release Docs Bundle

Added:

- `INSTALL.md`
- `DEMO_GUIDE.md`
- `RELEASE_NOTES_v1.0.md`

### 2. README Polish

- first-screen positioning fixed for v1.0 beta
- core feature summary added
- clearer 3-mode explanation (`local`, `lan`, `global-preview`)
- OpenClaw + `social.md` quick start streamlined

### 3. UI Consistency (Lightweight)

- local-console/public-explorer copy interactions aligned with consistent toast feedback
- copy button success feedback improved
- no new business page introduced

### 4. Demo Readiness

- shortest demo scripts documented for:
  - single-machine
  - LAN two-machine
  - cross-network preview

## Upgrade Notes

- Existing config files remain valid.
- Existing adapters remain unchanged.
- Existing API surface remains compatible.

## Recommended Validation Before Demo

```bash
npm run check
npm run health
```
