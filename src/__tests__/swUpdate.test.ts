import {
  shouldPromptForUpdate,
  shouldReloadOnControllerChange,
} from '../utils/swUpdate'

describe('shouldPromptForUpdate', () => {
  test('installed + existing controller → prompt (genuine update)', () => {
    expect(shouldPromptForUpdate('installed', true)).toBe(true)
  })

  test('installed + no controller → no prompt (first install activates quietly)', () => {
    expect(shouldPromptForUpdate('installed', false)).toBe(false)
  })

  test('intermediate states never prompt', () => {
    expect(shouldPromptForUpdate('installing', true)).toBe(false)
    expect(shouldPromptForUpdate('activating', true)).toBe(false)
    expect(shouldPromptForUpdate('activated', true)).toBe(false)
    expect(shouldPromptForUpdate('redundant', true)).toBe(false)
  })
})

describe('shouldReloadOnControllerChange', () => {
  test('reloads on the first controllerchange', () => {
    expect(shouldReloadOnControllerChange(false)).toBe(true)
  })

  test('never reloads again once latched (no reload loop)', () => {
    expect(shouldReloadOnControllerChange(true)).toBe(false)
  })

  test('models the host latch: reload exactly once across repeated events', () => {
    let reloaded = false
    let reloadCount = 0
    const onControllerChange = () => {
      if (!shouldReloadOnControllerChange(reloaded)) return
      reloaded = true
      reloadCount += 1
    }
    // Fire controllerchange several times — only the first must act.
    onControllerChange()
    onControllerChange()
    onControllerChange()
    expect(reloadCount).toBe(1)
  })
})
