# ADR-0008: Partition deletion via tombstones

## Status
Accepted

## Context
A session obtained with `session.fromPartition` cannot be unloaded from the
running process; on Windows its files stay locked.

## Options
Delete the directory immediately (unsafe while loaded), clear storage only
(leaves directory), **clear now + tombstone + delete on next boot**.

## Decision
Remove account:
1. Stop the runtime (views closed).
2. DB transaction: delete account/instance rows, insert
   `partition_tombstones(partition_id)`.
3. `clearStorageData()`, `clearCache()`, `clearAuthCache()` on the session.
4. Next startup, before any `fromPartition`: delete
   `userData/Partitions/gh-<partitionId>` and the tombstone row.

Partition ids are never reused.

## Consequences
- Robust against crashes mid-removal; disk space is reclaimed on restart.

## Removing a game
A game is removed by removing each of its accounts through exactly the path above, one at a time,
and only then deleting the game row. The foreign key from accounts to games is RESTRICT, so the
database itself refuses to delete a game that still has an account (for example one created while
the removal was running); the request then fails with `INVALID_STATE` instead of orphaning it.
There is a single way to delete browser data.

