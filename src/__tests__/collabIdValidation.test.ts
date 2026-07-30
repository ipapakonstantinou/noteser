/**
 * collabIdValidation.test.ts
 *
 * A collab room id is a bearer credential — anyone who knows it can read and
 * write that room on the configured Yjs server. Two of the three ways an id
 * reaches this app are not ours: a note's `collabId:` frontmatter (whoever can
 * write the vault repo picks it, and the pull adopts it "repo wins") and a
 * `?collab=…` share link. Neither is shape-checked before it becomes a room
 * name, so an arbitrary string could ride in.
 *
 * These pin the shape check at both entry points, and on the way back out.
 */

import { isValidCollabId } from '../utils/collabId'
import { parseNote, serializeNote } from '../utils/githubSync/internal'
import { parseCollabParam } from '../utils/collabShare'
import type { Note } from '@/types'

const VALID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('isValidCollabId', () => {
  test('accepts a v4 UUID in either case', () => {
    expect(isValidCollabId(VALID)).toBe(true)
    expect(isValidCollabId(VALID.toUpperCase())).toBe(true)
  })

  test.each([
    ['a v1 UUID (wrong version nibble)', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['a wrong variant nibble', '3f2504e0-4f89-41d3-1a0c-0305e82c3301'],
    ['a bare word', 'attacker-room'],
    ['a path', '../../etc/passwd'],
    ['a UUID with trailing junk', `${VALID} extra`],
    ['a UUID with a newline', `${VALID}\nsecond: line`],
    ['an empty string', ''],
    ['a non-string', null],
  ])('rejects %s', (_label, value) => {
    expect(isValidCollabId(value)).toBe(false)
  })
})

describe('frontmatter round-trip', () => {
  test('a valid id survives parse', () => {
    const parsed = parseNote(`---\ncollabId: ${VALID}\n---\nbody\n`)
    expect(parsed.collabId).toBe(VALID)
    expect(parsed.body).toBe('body\n')
  })

  test('a bogus id is dropped, and the body still parses', () => {
    const parsed = parseNote('---\ncollabId: attacker-room\n---\nbody\n')
    expect(parsed.collabId).toBeUndefined()
    expect(parsed.body).toBe('body\n')
  })

  test('a quoted bogus id is dropped too', () => {
    expect(parseNote('---\ncollabId: "../../evil"\n---\nx\n').collabId).toBeUndefined()
  })

  test('serializeNote emits a valid id and swallows an invalid one', () => {
    const withValid = serializeNote({ content: 'x', collabId: VALID } as Note)
    expect(withValid).toContain(`collabId: ${VALID}`)

    // A note that picked one up from an older build must stop republishing it.
    const withJunk = serializeNote({ content: 'x', collabId: 'attacker-room' } as Note)
    expect(withJunk).toBe('x\n')
    expect(withJunk).not.toContain('collabId')
  })
})

describe('share link', () => {
  test('a valid id parses', () => {
    expect(parseCollabParam(`?collab=${VALID}&title=Hi`)).toEqual({ collabId: VALID, title: 'Hi' })
  })

  test('a bogus id yields no join at all', () => {
    expect(parseCollabParam('?collab=attacker-room')).toBeNull()
    expect(parseCollabParam('?collab=')).toBeNull()
  })
})
