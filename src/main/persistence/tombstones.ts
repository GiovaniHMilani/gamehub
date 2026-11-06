import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isPartitionId } from '@shared/domain/partition'
import type { Logger } from '../logging/logger'
import type { TombstoneRepository } from './repositories'

/** Directory Chromium uses for `persist:gh-<id>` (verified in spike S3). */
export function partitionDirectory(userDataDir: string, partitionId: string): string {
  if (!isPartitionId(partitionId)) throw new Error('Invalid partitionId')
  return join(userDataDir, 'Partitions', `gh-${partitionId}`)
}

/**
 * Physically deletes partitions of removed accounts (ADR-0008).
 *
 * MUST run before anything calls `session.fromPartition`: a loaded session
 * cannot be unloaded, and on Windows its files stay locked. A tombstone is
 * only dropped after its directory is gone, so a failure is retried on the
 * next boot instead of leaking data.
 */
export async function processTombstones(
  userDataDir: string,
  tombstones: TombstoneRepository,
  log: Logger,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failed = 0
  for (const partitionId of tombstones.list()) {
    if (!isPartitionId(partitionId)) {
      // Never build a filesystem path from an unvalidated value.
      log.error('tombstone.invalid', { reason: 'malformed partitionId' })
      failed++
      continue
    }
    try {
      await rm(partitionDirectory(userDataDir, partitionId), { recursive: true, force: true })
      tombstones.delete(partitionId)
      deleted++
      log.info('tombstone.processed', { partitionId })
    } catch (error) {
      failed++
      log.error('tombstone.failed', { partitionId, error })
    }
  }
  return { deleted, failed }
}
