# ADR-0012: App identity and data paths

## Status
Accepted

## Context
Electron derives `userData` from the app name. Changing it later moves every
partition and logs every account out.

## Decision
- `productName`: `GameHub`; `appId`: `com.gamehub.app`. Frozen.
- Production `userData`: macOS `~/Library/Application Support/GameHub`,
  Windows `%APPDATA%\GameHub`. DB at `userData/gamehub.db`, partitions under
  `userData/Partitions/`.
- Development: `userData` set to `GameHub-dev` before `ready`.
- Tests: `userData` from `GAMEHUB_USER_DATA_DIR` (temporary directory).
- Data lives outside the app bundle and survives reinstall/update; uninstall
  does not delete it.

## Consequences
- Downgrading Electron/Chromium may not read a newer profile format.
