# ADR-0006: Security baseline

## Status
Accepted

## Context
Game pages are remote, untrusted content running next to a privileged shell.

## Decision
- `app.enableSandbox()`; shell: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`.
- Shell served from a custom `app://gamehub` protocol (`protocol.handle`), not
  `file://`, with a restrictive CSP.
- Game views and OAuth popups: **no preload**, sandboxed, no Node.
- `app.on('web-contents-created')` applies deny-by-default guards to every
  webContents (block `<webview>` attach, deny window.open, check navigation).
- Per-session handlers (configured once): permission request/check deny except
  `fullscreen`, `pointerLock`, `clipboard-sanitized-write`; device
  (HID/USB/serial/bluetooth) and display-media requests denied; downloads
  cancelled.
- Electron fuses at package time: RunAsNode off, NODE_OPTIONS off, inspect
  args off, OnlyLoadAppFromAsar on, asar integrity on, cookie encryption on.
- Logs never contain cookies, tokens, headers or URL query/hash.
- No user-agent spoofing or bypass of game/provider security.

## Consequences
- Web features games may request (notifications, media) stay denied until
  reviewed.
