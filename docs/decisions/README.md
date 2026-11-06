# Architecture Decisions

Format: Status / Context / Options / Decision / Consequences / Revisit when.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-window-model.md) | One shell window + WebContentsView per instance | Accepted |
| [0002](0002-partition-per-account.md) | Persistent partition per account | Accepted |
| [0003](0003-data-ownership.md) | SQLite metadata vs Electron session state | Accepted |
| [0004](0004-lifecycle-ownership.md) | Main-owned instance lifecycle | Accepted |
| [0005](0005-ipc-contract.md) | Explicit typed IPC contract | Accepted |
| [0006](0006-security-baseline.md) | Security baseline | Accepted |
| [0007](0007-navigation-policy.md) | Navigation and popup policy (incl. OAuth popups) | Accepted |
| [0008](0008-partition-deletion.md) | Partition deletion via tombstones | Accepted |
| [0009](0009-ui-over-views.md) | UI overlays above WebContentsViews | Accepted |
| [0010](0010-background-and-audio.md) | Background mode and audio policy | Accepted |
| [0011](0011-toolchain.md) | Toolchain | Accepted |
| [0012](0012-app-identity-and-paths.md) | App identity and data paths | Accepted |
| [0013](0013-single-instance-lock.md) | Single application instance | Accepted |
| [0014](0014-app-protocol.md) | Shell served from `app://gamehub` | Accepted |
| [0015](0015-event-sequencing.md) | Sequenced events and snapshots | Accepted |
| [0016](0016-blocked-origin-notices.md) | Ask the user when an origin is blocked | Accepted |
| [0017](0017-renderer-driven-stage.md) | The renderer says where game views go; Main applies it | Accepted |
| [0018](0018-ui-state-and-styling.md) | UI state, components and styling | Accepted |
| [0019](0019-background-instances.md) | Background instances are already throttled; no economy mode | Accepted |
