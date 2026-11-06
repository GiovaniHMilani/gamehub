# ADR-0002: Persistent partition per account

## Status
Accepted (supersedes the `persist:gamehub-instance-<instance-id>` example in
earlier CLAUDE.md text)

## Context
The login belongs to the account. Each account needs isolated, persistent
cookies, storage, cache and service workers that survive restarts.

## Options
| Option | Problem |
|---|---|
| partition per game | all accounts share login — violates the invariant |
| partition per instance id | recreating an instance logs the user out; two instances of one account would have two logins |
| `defaultSession` / in-memory | shared or non-persistent |
| `session.fromPath()` | viable, less conventional; kept as fallback |
| **partition per account via immutable `partitionId`** | — |

## Decision
- `game_accounts.partition_id`: UUID v4, generated in Main inside the account
  INSERT transaction, `UNIQUE`, never changed implicitly, never reused.
- Partition name: `persist:gh-<partitionId>` (lowercase `[a-z0-9-]`).
- Account ↔ instance cardinality is 1 : 0..1 (`game_instances.account_id UNIQUE`).
- Only `SessionManager.get(accountId)` resolves a partition; no API accepts a
  partition string from outside.
- An in-memory `partitionId → instanceId` map asserts that no two live
  runtimes claim the same partition.
- On session failure, the instance enters `error`; a new session is never
  created silently.

## Consequences
- Positive: login survives instance recreation; a future "reset browser data"
  can rotate `partitionId` without changing account identity.
- Negative: relaxing to several instances per account later means two views on
  one session (same login) — acceptable, explicit.

## Revisit when
A product requirement needs multiple simultaneous views of one account.
