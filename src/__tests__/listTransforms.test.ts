import {
  splitListLine,
  toggleDone,
  toggleTodo,
  toggleNumbered,
  toggleBullet,
  cycleState,
  nextCycleState,
  setCycleState,
  cycleListType,
  renumberOrderedRuns,
  tightListContinuation,
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

describe('toggleBullet (Mod+Alt+Shift+B)', () => {
  it('plain -> bullet', () => {
    expect(toggleBullet('thing')).toBe('- thing')
  })
  it('bullet -> plain', () => {
    expect(toggleBullet('* thing')).toBe('thing')
  })
  it('"- " bullet -> plain', () => {
    expect(toggleBullet('- thing')).toBe('thing')
  })
  it('ordered -> bullet', () => {
    expect(toggleBullet('2. thing')).toBe('- thing')
  })
  it('round-trips plain -> bullet -> plain', () => {
    expect(toggleBullet(toggleBullet('thing'))).toBe('thing')
  })
  it('preserves indentation when adding the bullet', () => {
    expect(toggleBullet('   sub')).toBe('   - sub')
  })
  it('preserves indentation when removing the bullet', () => {
    expect(toggleBullet('   - sub')).toBe('   sub')
  })
})

describe('cycleState', () => {
  it('classifies plain', () => {
    expect(cycleState('thing')).toBe('plain')
  })
  it('treats a bullet as the cycle "plain" slot', () => {
    expect(cycleState('- thing')).toBe('plain')
  })
  it('classifies ordered', () => {
    expect(cycleState('1. thing')).toBe('ordered')
  })
  it('classifies a task (checked or unchecked)', () => {
    expect(cycleState('- [ ] thing')).toBe('task')
    expect(cycleState('- [x] thing')).toBe('task')
    expect(cycleState('2. [ ] thing')).toBe('task')
  })
})

describe('nextCycleState', () => {
  it('advances plain -> ordered -> task -> plain', () => {
    expect(nextCycleState('plain')).toBe('ordered')
    expect(nextCycleState('ordered')).toBe('task')
    expect(nextCycleState('task')).toBe('plain')
  })
})

describe('setCycleState', () => {
  it('rewrites a line to plain, keeping body + indent', () => {
    expect(setCycleState('  1. sub', 'plain')).toBe('  sub')
    expect(setCycleState('- [x] done', 'plain')).toBe('done')
  })
  it('rewrites a line to ordered', () => {
    expect(setCycleState('thing', 'ordered')).toBe('1. thing')
    expect(setCycleState('- [ ] thing', 'ordered')).toBe('1. thing')
  })
  it('rewrites a line to task (unchecked)', () => {
    expect(setCycleState('thing', 'task')).toBe('- [ ] thing')
    expect(setCycleState('1. thing', 'task')).toBe('- [ ] thing')
  })
  it('preserves indent', () => {
    expect(setCycleState('   deep', 'ordered')).toBe('   1. deep')
  })
})

describe('cycleListType (Mod+Alt+Shift+L)', () => {
  it('plain -> numbered', () => {
    expect(cycleListType('thing')).toBe('1. thing')
  })
  it('numbered -> task', () => {
    expect(cycleListType('1. thing')).toBe('- [ ] thing')
  })
  it('task -> plain', () => {
    expect(cycleListType('- [ ] thing')).toBe('thing')
  })
  it('checked task -> plain (drops the checkbox)', () => {
    expect(cycleListType('- [x] thing')).toBe('thing')
  })
  it('a bullet advances to numbered (treated as plain)', () => {
    expect(cycleListType('- thing')).toBe('1. thing')
  })
  it('completes a full round trip back to plain', () => {
    let line = 'thing'
    line = cycleListType(line) // -> 1. thing
    expect(line).toBe('1. thing')
    line = cycleListType(line) // -> - [ ] thing
    expect(line).toBe('- [ ] thing')
    line = cycleListType(line) // -> thing
    expect(line).toBe('thing')
  })
  it('preserves indent through the cycle', () => {
    expect(cycleListType('  sub')).toBe('  1. sub')
    expect(cycleListType('  1. sub')).toBe('  - [ ] sub')
    expect(cycleListType('  - [ ] sub')).toBe('  sub')
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

describe('tightListContinuation (Enter)', () => {
  it('continues a task line with a single fresh unchecked box (no blank line)', () => {
    // This is the regression: in a "loose" list the markdown keymap would
    // produce "\n\n- [ ] "; the continuation we insert must be just "- [ ] ".
    expect(tightListContinuation('- [ ] Some task')).toBe('- [ ] ')
  })

  it('continues a checked task as a fresh UNCHECKED box', () => {
    expect(tightListContinuation('- [x] done')).toBe('- [ ] ')
  })

  it('preserves indentation for nested items', () => {
    expect(tightListContinuation('  - [ ] nested')).toBe('  - [ ] ')
    expect(tightListContinuation('\t- bullet')).toBe('\t- ')
  })

  it('repeats a bullet marker', () => {
    expect(tightListContinuation('- foo')).toBe('- ')
    expect(tightListContinuation('* foo')).toBe('* ')
  })

  it('advances an ordered item to the next number', () => {
    expect(tightListContinuation('1. first')).toBe('2. ')
    expect(tightListContinuation('  7. x')).toBe('  8. ')
  })

  it('returns null for a plain line (default Enter splits it)', () => {
    expect(tightListContinuation('just text')).toBeNull()
    expect(tightListContinuation('')).toBeNull()
  })

  it('returns null for an empty list item so default Enter exits the list', () => {
    expect(tightListContinuation('- ')).toBeNull()
    expect(tightListContinuation('1. ')).toBeNull()
    expect(tightListContinuation('- [ ] ')).toBeNull()
  })
})
