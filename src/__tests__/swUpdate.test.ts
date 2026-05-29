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
  test('does NOT reload on the first-install claim (no prior controller)', () => {
    // The fresh-install clients.claim() fires controllerchange with no update
    // takeover — reloading there made every new visitor load twice.
    expect(shouldReloadOnControllerChange(false, false)).toBe(false)
  })

  test('reloads on a genuine update takeover', () => {
    expect(shouldReloadOnControllerChange(false, true)).toBe(true)
  })

  test('never reloads again once latched (no reload loop)', () => {
    expect(shouldReloadOnControllerChange(true, true)).toBe(false)
  })

  test('models the host latch: reload exactly once across repeated update events', () => {
    let reloaded = false
    let reloadCount = 0
    const onControllerChange = () => {
      if (!shouldReloadOnControllerChange(reloaded, true)) return
      reloaded = true
      reloadCount += 1
    }
    onControllerChange()
    onControllerChange()
    onControllerChange()
    expect(reloadCount).toBe(1)
  })

  test('a first-install claim followed by a later update: only the update reloads', () => {
    // First the claim (no takeover) must not reload; then an update takeover must.
    expect(shouldReloadOnControllerChange(false, false)).toBe(false)
    expect(shouldReloadOnControllerChange(false, true)).toBe(true)
  })
})
