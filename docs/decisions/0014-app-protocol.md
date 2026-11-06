# ADR-0014: The shell is served from `app://gamehub`, not `file://`

## Status
Accepted

## Context
The shell (React UI) is the only page allowed to call the privileged IPC API
(ADR-0005). Loading it from `file://` gives it an opaque origin, makes CSP
`'self'` unreliable, and ties trust to a filesystem path.

## Decision
- Scheme `app`, host `gamehub`: the shell lives at `app://gamehub/index.html`.
  Registered with `protocol.registerSchemesAsPrivileged` before `ready` with
  `standard`, `secure`, `supportFetchAPI` only. NOT granted: `bypassCSP`,
  service workers, `corsEnabled`, streaming.
- Served by `protocol.handle('app', ...)` on the **default session only**. Game
  partitions have no handler, so remote game pages cannot load shell assets
  through `app://` (asserted by test).
- It is not a file server. `resolveAppAsset` (pure, unit-tested) maps a URL path
  onto one root, the built renderer (`out/renderer`):
  - percent-decoded exactly once; any `%` left, `\`, `:` or NUL is refused
    (double encoding, encoded separators, drive letters);
  - any `.`/`..`/dotfile segment is refused;
  - only an allowlist of web asset types (`html js css svg png ico woff woff2`);
  - result must stay inside the root, and the real path (symlinks resolved)
    must too.
  Anything refused, missing or on another host answers a plain 404 (no oracle).
- IPC sender guard additionally requires the sender frame URL to be
  `app://gamehub/...` (or the Vite dev server origin, only when unpackaged and
  `ELECTRON_RENDERER_URL` is set). Protocol and host are compared explicitly:
  in Node, `new URL('app://x').origin` is the string `'null'`.
- Development keeps the Vite dev server (HMR) over `http://localhost:5173`:
  a custom protocol cannot proxy HMR. Tests and packaged builds use `app://`.
- CSP stays a `<meta>` injected per mode by the Vite plugin: strict in builds.

## Consequences
- Positive: the shell has a real origin; trust no longer depends on a path.
- Negative: the dev shell and the production shell differ in origin; a bug that
  only appears under `app://` is caught by the E2E suite, not by `pnpm dev`.
- Known limit: for a failed load Electron reports the *requested* URL in
  `frame.url`, so the sender guard cannot tell Chromium's error page from the
  real shell. The error page has no attacker-controlled content, and the shell
  cannot navigate away (`will-navigate` is blocked), so this is accepted.
