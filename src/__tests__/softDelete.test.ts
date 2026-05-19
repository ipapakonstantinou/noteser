import {
  softDelete,
  restoreSoftDeleted,
  permanentlyDelete,
  emptyTrash,
  type SoftDeletable,
} from '../utils/softDelete'

interface Item extends SoftDeletable {
  name: string
}

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    name: overrides.name ?? id,
    isDeleted: overrides.isDeleted ?? false,
    deletedAt: overrides.deletedAt ?? null,
  }
}

describe('softDelete', () => {
  test('marks the matching item deleted with the provided timestamp', () => {
    const items = [makeItem('a'), makeItem('b')]
    const result = softDelete(items, 'a', 1234)
    expect(result[0]).toMatchObject({ id: 'a', isDeleted: true, deletedAt: 1234 })
    expect(result[1]).toMatchObject({ id: 'b', isDeleted: false, deletedAt: null })
  })

  test('does not mutate the input array', () => {
    const items = [makeItem('a')]
    softDelete(items, 'a', 0)
    expect(items[0]).toMatchObject({ isDeleted: false, deletedAt: null })
  })

  test('is a no-op when the id is missing', () => {
    const items = [makeItem('a')]
    const result = softDelete(items, 'missing', 1)
    expect(result).toEqual(items)
  })

  test('updates deletedAt on an already-deleted item', () => {
    const items = [makeItem('a', { isDeleted: true, deletedAt: 1 })]
    const result = softDelete(items, 'a', 99)
    expect(result[0].deletedAt).toBe(99)
  })
})

describe('restoreSoftDeleted', () => {
  test('clears isDeleted + deletedAt for the matching item', () => {
    const items = [makeItem('a', { isDeleted: true, deletedAt: 5 }), makeItem('b')]
    const result = restoreSoftDeleted(items, 'a')
    expect(result[0]).toMatchObject({ isDeleted: false, deletedAt: null })
    expect(result[1]).toMatchObject({ isDeleted: false, deletedAt: null })
  })

  test('no-op on a non-deleted item (idempotent)', () => {
    const items = [makeItem('a')]
    expect(restoreSoftDeleted(items, 'a')[0]).toMatchObject({ isDeleted: false, deletedAt: null })
  })
})

describe('permanentlyDelete', () => {
  test('removes the matching item', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')]
    expect(permanentlyDelete(items, 'b').map(i => i.id)).toEqual(['a', 'c'])
  })

  test('no-op when the id is missing', () => {
    const items = [makeItem('a')]
    expect(permanentlyDelete(items, 'missing')).toEqual(items)
  })

  test('does not mutate the input array', () => {
    const items = [makeItem('a'), makeItem('b')]
    permanentlyDelete(items, 'a')
    expect(items.map(i => i.id)).toEqual(['a', 'b'])
  })
})

describe('emptyTrash', () => {
  test('drops every soft-deleted item', () => {
    const items = [
      makeItem('a', { isDeleted: true, deletedAt: 1 }),
      makeItem('b'),
      makeItem('c', { isDeleted: true, deletedAt: 2 }),
    ]
    expect(emptyTrash(items).map(i => i.id)).toEqual(['b'])
  })

  test('preserves an array with no deleted items', () => {
    const items = [makeItem('a'), makeItem('b')]
    expect(emptyTrash(items).map(i => i.id)).toEqual(['a', 'b'])
  })

  test('returns [] when everything is deleted', () => {
    const items = [makeItem('a', { isDeleted: true }), makeItem('b', { isDeleted: true })]
    expect(emptyTrash(items)).toEqual([])
  })
})
