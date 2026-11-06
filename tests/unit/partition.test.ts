import { describe, expect, it } from 'vitest'
import { isPartitionId, partitionNameFor, PARTITION_PREFIX } from '@shared/domain/partition'

describe('partitionNameFor', () => {
  it('builds a persistent partition name from a v4 UUID', () => {
    const id = '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b'
    expect(partitionNameFor(id)).toBe(`${PARTITION_PREFIX}${id}`)
    expect(partitionNameFor(id).startsWith('persist:')).toBe(true)
  })

  it('gives different accounts different partitions', () => {
    const a = partitionNameFor(crypto.randomUUID())
    const b = partitionNameFor(crypto.randomUUID())
    expect(a).not.toBe(b)
  })

  it.each([
    '',
    'game-pokeidle',
    '7B2F4C1E-9A3D-4E5F-8A6B-1C2D3E4F5A6B', // uppercase is not canonical
    '7b2f4c1e-9a3d-1e5f-8a6b-1c2d3e4f5a6b', // not v4
    '../7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b',
    '7b2f4c1e-9a3d-4e5f-8a6b-1c2d3e4f5a6b/..',
  ])('rejects %j', (bad) => {
    expect(isPartitionId(bad)).toBe(false)
    expect(() => partitionNameFor(bad)).toThrow()
  })

  it('rejects non-strings', () => {
    expect(isPartitionId(42)).toBe(false)
    expect(isPartitionId(undefined)).toBe(false)
  })
})
