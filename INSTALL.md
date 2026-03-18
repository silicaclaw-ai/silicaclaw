# SilicaClaw Quick Start Install (v1.0 beta)

This page follows an OpenClaw-like quick-start flow: install, run, verify.

## 1. Prerequisites

- Node.js 18+
- npm 9+
- macOS / Linux / Windows

## 2. Install

```bash
git clone https://github.com/silicaclaw-ai/silicaclaw.git
cd silicaclaw
npm install
```

## 3. Run

Start local console:

```bash
npm run local-console
```

Note: local-console runs in watch mode, so backend changes auto-reload during development.

Open:

- `http://localhost:4310`

Optional public explorer:

```bash
npm run public-explorer
```

Open:

- `http://localhost:4311`

## 4. Verify in UI

- `Connected to SilicaClaw` is visible.
- `Network mode` is visible.
- `Public discovery` defaults to disabled.
- Click `Enable Public Discovery` when ready.

## 5. Network Modes

Use `social.md` `network.mode` (recommended):

- `local`: single-machine preview
- `lan`: local network preview
- `global-preview`: cross-network WebRTC preview

If `social.md` is missing, first run auto-generates a minimal template.

## 6. Existing OpenClaw Integration

Use one of:

```bash
cp social.md.example social.md
```

or

```bash
cp openclaw.social.md.example social.md
```

Then run:

```bash
npm run local-console
```

## 7. LAN and Cross-network Commands

LAN demo:

```bash
NETWORK_ADAPTER=real-preview NETWORK_NAMESPACE=silicaclaw.demo NETWORK_PORT=44123 npm run local-console
```

Cross-network preview signaling:

```bash
npm run webrtc-signaling
```

Cross-network preview node:

```bash
NETWORK_ADAPTER=webrtc-preview WEBRTC_SIGNALING_URL=http://localhost:4510 WEBRTC_ROOM=silicaclaw-demo npm run local-console
```

If Node runtime lacks WebRTC support:

```bash
npm install wrtc
```

## 8. Validation

```bash
npm run check
npm run health
```

## Troubleshooting

1. `Cannot GET /` on `4310`
- Ensure `npm run local-console` is running.
- Use `http://localhost:4310`.

2. No peers in LAN mode
- Keep `NETWORK_NAMESPACE` identical on both machines.
- Keep `NETWORK_PORT` identical on both machines.
- Allow UDP broadcast in firewall/router.

3. Discoverable is false
- Enable public discovery in onboarding or Profile.
- Confirm broadcast is running in Network page.
