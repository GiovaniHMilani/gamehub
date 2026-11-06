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
| [0007](0007-navigation-policy.md) | Navigation and popup policy | Accepted |
| [0008](0008-partition-deletion.md) | Partition deletion via tombstones | Accepted |
| [0009](0009-ui-over-views.md) | UI overlays above WebContentsViews | Accepted |
| [0010](0010-background-and-audio.md) | Background mode and audio policy | Accepted |
| [0011](0011-toolchain.md) | Toolchain | Accepted (driver pending spike) |
| [0012](0012-app-identity-and-paths.md) | App identity and data paths | Accepted |
| [0013](0013-single-instance-lock.md) | Single application instance | Accepted |
