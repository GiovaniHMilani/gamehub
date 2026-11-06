/**
 * Partition naming for account browser identities (ADR-0002).
 *
 * A partitionId is a lowercase UUID v4 generated in Main. It is never derived
 * from renderer input, URLs or user-provided strings.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const PARTITION_PREFIX = 'persist:gh-'

export function isPartitionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

export function partitionNameFor(partitionId: string): string {
  if (!isPartitionId(partitionId)) {
    throw new Error('Invalid partitionId')
  }
  return `${PARTITION_PREFIX}${partitionId}`
}
