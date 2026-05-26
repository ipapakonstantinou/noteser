import {
  splitListLine,
  toggleDone,
  toggleTodo,
  toggleNumbered,
  toggleBullet,
  cycleNumberedTask,
  renumberOrderedRuns,
} from '@/utils/listTransforms'

describe('splitListLine', () => {
  it('classifies a plain line', () => {
    expect(splitListLine('hello')).toMatchObject({ kind: 'plain', indent: '', body: 'hello' })
  })
  it('classifies a bullet line and preserves indent', () => {
    expect(splitListLine('  - foo')).toMatchObject({ kind: 'bullet', indent: '  ', body: 'foo' })
  })
  it('classifies an ordered line', () => {
    expect(splitListLine('3. foo')).toMatchObject({ kind: 'ordered', carrier: '3. ', body: 'foo' })
  })
  it('classifies a task line and captures the checkbox', () => {
    expect(splitListLine('- [x] done')).toMatchObject({ kind: 'task', check: 'x', body: 'done' })
  })
  it('classifies a numbered task as a task', () => {
    expect(splitListLine('2. [ ] foo')).toMatchObject({ kind: 'task', carrier: '2. ', body: 'foo' })
  })
})

describe('toggleDone (Mod+L)', () => {
  it('plain -> unchecked task', () => {
    expect(toggleDone('buy milk')).toBe('- [ ] buy milk')
  })
  it('bullet -> unchecked task keeping the bullet carrier', () => {
    expect(toggleDone('- buy milk')).toBe('- [ ] buy milk')
  })
  it('ordered -> unchecked task keeping the number carrier', () => {
    expect(toggleDone('1. buy milk')).toBe('1. [ ] buy milk')
  })
  it('unchecked task -> checked', () => {
    expect(toggleDone('- [ ] buy milk')).toBe('- [x] buy milk')
  })
  it('checked task -> unchecked', () => {
    expect(toggleDone('- [x] buy milk')).toBe('- [ ] buy milk')
  })
  it('preserves indentation', () => {
    expect(toggleDone('    - [ ] nested')).toBe('    - [x] nested')
  })
  it('handles an empty task body without trailing space', () => {
    expect(toggleDone('- [ ] ')).toBe('- [x]')
  })
})

describe('toggleTodo', () => {
  it('plain -> task', () => {
    expect(toggleTodo('thing')).toBe('- [ ] thing')
  })
  it('task -> plain (strips marker, keeps body + indent)', () => {
    expect(toggleTodo('  - [x] thing')).toBe('  thing')
  })
  it('bullet -> task', () => {
    expect(toggleTodo('- thing')).toBe('- [ ] thing')
  })
})

describe('toggleNumbered', () => {
  it('plain -> ordered', () => {
    expect(toggleNumbered('thing')).toBe('1. thing')
  })
  it('bullet -> ordered', () => {
    expect(toggleNumbered('- thing')).toBe('1. thing')
  })
  it('ordered -> plain', () => {
    expect(toggleNumbered('5. thing')).toBe('thing')
  })
  it('task -> numbered task', () => {
    expect(toggleNumbered('- [ ] thing')).toBe('1. [ ] thing')
  })
  it('preserves indent', () => {
    expect(toggleNumbered('   sub')).toBe('   1. sub')
  })
})

describe('toggleBullet', () => {
  it('plain -> bullet', () => {
    expect(toggleBullet('thing')).toBe('- thing')
  })
  it('bullet -> plain', () => {
    expect(toggleBullet('* thing')).toBe('thing')
  })
  it('ordered -> bullet', () => {
    expect(toggleBullet('2. thing')).toBe('- thing')
  })
})

describe('cycleNumberedTask', () => {
  it('ordered -> task', () => {
    expect(cycleNumberedTask('1. thing')).toBe('- [ ] thing')
  })
  it('task -> ordered', () => {
    expect(cycleNumberedTask('- [ ] thing')).toBe('1. thing')
  })
  it('checked task -> ordered (drops checkbox)', () => {
    expect(cycleNumberedTask('- [x] thing')).toBe('1. thing')
  })
  it('bullet -> ordered', () => {
    expect(cycleNumberedTask('- thing')).toBe('1. thing')
  })
  it('plain -> ordered', () => {
    expect(cycleNumberedTask('thing')).toBe('1. thing')
  })
  it('preserves indent', () => {
    expect(cycleNumberedTask('  1. sub')).toBe('  - [ ] sub')
  })
})

describe('renumberOrderedRuns', () => {
  it('renumbers a simple run that starts wrong', () => {
    const input = ['1. a', '1. b', '1. c'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(['1. a', '2. b', '3. c'].join('\n'))
  })

  it('fixes numbers after a reorder (was 2,1,3 -> 1,2,3)', () => {
    const input = ['2. a', '1. b', '3. c'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(['1. a', '2. b', '3. c'].join('\n'))
  })

  it('restarts after a blank line', () => {
    const input = ['1. a', '5. b', '', '9. c', '9. d'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(['1. a', '2. b', '', '1. c', '2. d'].join('\n'))
  })

  it('restarts after a non-list line', () => {
    const input = ['1. a', '2. b', 'paragraph', '7. c'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(['1. a', '2. b', 'paragraph', '1. c'].join('\n'))
  })

  it('keeps independent counters per indent level', () => {
    const input = [
      '1. a',
      '   1. a1',
      '   5. a2',
      '9. b',
    ].join('\n')
    expect(renumberOrderedRuns(input)).toBe(
      ['1. a', '   1. a1', '   2. a2', '2. b'].join('\n'),
    )
  })

  it('renumbers numbered task lines too', () => {
    const input = ['3. [ ] a', '3. [x] b'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(['1. [ ] a', '2. [x] b'].join('\n'))
  })

  it('leaves bullet lists untouched', () => {
    const input = ['- a', '- b'].join('\n')
    expect(renumberOrderedRuns(input)).toBe(input)
  })

  it('is idempotent', () => {
    const input = ['2. a', '1. b'].join('\n')
    const once = renumberOrderedRuns(input)
    expect(renumberOrderedRuns(once)).toBe(once)
  })
})
