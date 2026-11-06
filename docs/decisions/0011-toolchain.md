# ADR-0011: Toolchain

## Status
Accepted. SQLite driver resolved by spike S1 (`docs/development/spikes.md`).

## Context
Three Electron build targets (main, preload, renderer), a native-ish
persistence layer and Electron-level E2E tests, with minimal dependencies.

## Decision
- Build: `electron-vite` (main/preload/renderer Vite builds, HMR) +
  `electron-builder` (dmg for macOS, NSIS for Windows). No Linux target, no
  auto-update.
- Language: TypeScript strict, separate tsconfigs per layer.
- UI: React, Tailwind CSS, shadcn/ui (popovers constrained by ADR-0009),
  Zustand as read-model.
- Validation: `zod` (IPC boundary, persisted JSON).
- Persistence: SQLite + Drizzle ORM, confined to `main/persistence`.
  Driver: `better-sqlite3@13` (Node-API binary works in Node and Electron
  without rebuild; Drizzle has no `node:sqlite` driver).
- Tests: Vitest (unit), Playwright `_electron` (integration/E2E; game views
  are reachable as Playwright pages).
- Package manager: pnpm.
- Pinned: Electron 45.2.3, TypeScript 6.0.x (typescript-eslint does not yet
  support TS 7), Vite 8, electron-vite 6.
- Shell CSP is injected per mode by a Vite plugin: strict in builds; the local
  dev server additionally allows inline scripts for the React Refresh preamble.

## Rejected
- Electron Forge: more config for the same result with electron-builder.
- Router / React Query: single-screen app with push-based IPC.
