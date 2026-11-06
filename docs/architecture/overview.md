# Architecture Overview

GameHub separates application metadata from browser state.

SQLite:
- Games
- Accounts
- Instances
- Layout
- Preferences

Electron Sessions:
- Cookies
- localStorage
- IndexedDB
- authentication state
- browser cache

Main process:
- lifecycle
- sessions
- WebContentsView
- IPC handlers
- database

Renderer:
- React UI
- presentation state
- user interactions

Preload:
- minimal typed bridge between Renderer and Main
