import { test, expect, type Page } from '@playwright/test'
import { MIN_GROUP_HEIGHT, SETTINGS_PERSIST_VERSION } from '../src/stores/settingsStore'

// Stacked sidebar groups and the resize handle between them, measured in
// a real layout (jsdom has none).
//
// A drag on the handle stores a px height for BOTH groups. Nothing filled
// the stack after that, so a taller window left dead space under the file
// tree (#430). The last expanded group must always fill the stack,
// including for heights already stored in localStorage.

// The folder tree is server-rendered, so wait for hydration before using
// the store hooks.
const waitForTestHooks = (page: Page) =>
  page.waitForFunction(() => typeof window.__noteser_test !== 'undefined', undefined, { timeout: 10_000 })

type Heights = [number | null, number | null]
type Side = 'left' | 'right'

// Calendar over files on the left. With `right`, properties over
// backlinks on the right too (else the default single right group).
async function seed(page: Page, heights: Heights, right?: Heights) {
  await page.addInitScript(({ heights, right, version }) => {
    try { window.localStorage.clear() } catch { /* ignore */ }
    try {
      for (const name of ['noteser', 'keyval-store']) indexedDB.deleteDatabase(name)
    } catch { /* ignore */ }
    window.localStorage.setItem('noteser-settings', JSON.stringify({
      state: {
        onboardingShown: true,
        sidebarGroups: [
          { id: 'g-top', tabs: ['calendar'], activeTab: 'calendar', collapsed: false, height: heights[0] },
          { id: 'g-files', tabs: ['files'], activeTab: 'files', collapsed: false, height: heights[1] },
        ],
        ...(right && {
          rightSidebarGroups: [
            { id: 'r-top', tabs: ['properties'], activeTab: 'properties', collapsed: false, height: right[0] },
            { id: 'r-bottom', tabs: ['backlinks'], activeTab: 'backlinks', collapsed: false, height: right[1] },
          ],
        }),
      },
      version,
    }))
  }, { heights, right, version: SETTINGS_PERSIST_VERSION })
}

const handleOf = (page: Page, side: Side) => page
  .getByTestId(side === 'left' ? 'sidebar-stack' : 'right-sidebar-stack')
  .getByTestId('sidebar-group-resize-handle')

// Distance from the last group's bottom edge to the stack's bottom edge.
const gapBelowLastGroup = (page: Page) => page.evaluate(() => {
  const stack = document.querySelector('[data-testid="sidebar-stack"]')!
  const groups = stack.querySelectorAll('[data-testid="sidebar-group"]')
  const last = groups[groups.length - 1]
  return Math.abs(stack.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom)
})

const storedHeights = (page: Page, side: Side = 'left') => page.evaluate((side) => {
  const s = window.__noteser_test!.stores.settingsStore.getState()
  return (side === 'left' ? s.sidebarGroups : s.rightSidebarGroups).map(g => g.height ?? null)
}, side)

async function dragHandle(page: Page, dy: number, side: Side = 'left') {
  const box = (await handleOf(page, side).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 10 })
  await page.mouse.up()
}

const topHeight = async (page: Page) =>
  (await page.getByTestId('sidebar-group').first().boundingBox())!.height

test('stored heights on both groups (an earlier drag) still let the last group fill', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await seed(page, [361, 256])
  await page.goto('/')
  await waitForTestHooks(page)
  await expect(page.getByTestId('sidebar-group')).toHaveCount(2)

  await expect.poll(() => gapBelowLastGroup(page)).toBeLessThan(1)
  expect(await topHeight(page)).toBe(361)
})

test('drag at 720px tall, then grow the window: the file tree reaches the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await seed(page, [null, null])
  await page.goto('/')
  await waitForTestHooks(page)
  await expect(handleOf(page, 'left')).toBeVisible()

  await dragHandle(page, 100)
  await expect.poll(() => storedHeights(page)).toEqual([expect.any(Number), expect.any(Number)])
  const dragged = await topHeight(page)

  await page.setViewportSize({ width: 1280, height: 1400 })
  await expect.poll(() => gapBelowLastGroup(page)).toBeLessThan(1)
  expect(await topHeight(page)).toBe(dragged)

  // Same session: the files group's draft from the 720px window must not
  // cap the handle, so a long drag keeps tracking the pointer.
  await dragHandle(page, 300)
  await expect.poll(async () => Math.abs((await topHeight(page)) - (dragged + 300))).toBeLessThanOrEqual(1)
  await expect.poll(() => gapBelowLastGroup(page)).toBeLessThan(1)
})

// Wait until the stack has re-rendered with real measurements, so a test
// never starts from the pre-hydration numbers.
const waitForMeasured = (page: Page, side: Side = 'left') => expect.poll(async () =>
  Number(await handleOf(page, side).getAttribute('aria-valuemax'))).toBeGreaterThan(500)

// Rendered heights of a two-group stack, its overflow, and the gap under
// the last group.
const groupHeights = (page: Page, side: Side = 'left') => page.evaluate((side) => {
  const prefix = side === 'left' ? '' : 'right-'
  const stack = document.querySelector(`[data-testid="${prefix}sidebar-stack"]`)!
  const groups = [...stack.querySelectorAll(`[data-testid="${prefix}sidebar-group"]`)]
  const [top, bottom] = groups.map(el => el.getBoundingClientRect().height)
  const gap = stack.getBoundingClientRect().bottom - groups[groups.length - 1].getBoundingClientRect().bottom
  return { top, bottom, overflow: stack.scrollHeight - stack.clientHeight, gap: Math.abs(gap) }
}, side)

test('the first drag after load moves the boundary by exactly the drag', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await seed(page, [361, 256])
  await page.goto('/')
  await waitForTestHooks(page)
  await waitForMeasured(page)

  await dragHandle(page, -60)
  await expect.poll(async () => Math.abs((await topHeight(page)) - 301)).toBeLessThanOrEqual(1)
})

test('a drag right after a double-click reset moves the boundary by exactly the drag', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await seed(page, [361, 256])
  await page.goto('/')
  await waitForTestHooks(page)
  await waitForMeasured(page)

  await handleOf(page, 'left').dblclick()
  await expect.poll(() => storedHeights(page)).toEqual([null, null])
  const before = await topHeight(page)
  await dragHandle(page, 200)
  await expect.poll(async () => Math.abs((await topHeight(page)) - (before + 200))).toBeLessThanOrEqual(1)
})

test('keyboard: 16 and 64 px steps, End and Home stop at exactly the minimum', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await seed(page, [null, null])
  await page.goto('/')
  await waitForTestHooks(page)
  await waitForMeasured(page)
  await handleOf(page, 'left').focus()
  const start = await groupHeights(page)

  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => (await groupHeights(page)).top - start.top).toBe(16)
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(async () => (await groupHeights(page)).top - start.top).toBe(16 + 64)
  await page.keyboard.press('End')
  await expect.poll(() => groupHeights(page)).toMatchObject({ bottom: MIN_GROUP_HEIGHT, overflow: 0 })
  await page.keyboard.press('Home')
  await expect.poll(async () => (await groupHeights(page)).top).toBe(MIN_GROUP_HEIGHT)
})

for (const side of ['left', 'right'] as const) {
  test(`double-click on the grip line resets both groups (${side})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await seed(page, [361, 256], [300, 200])
    await page.goto('/')
    await waitForTestHooks(page)

    // The element centre is the 2px grip line drawn in the middle.
    await handleOf(page, side).dblclick()
    await expect.poll(() => storedHeights(page, side)).toEqual([null, null])
  })
}

// Drag the upper group to about 1000px at 1280x1400, then shrink the
// window to 600: stored heights are preferred sizes, not hard ones.
async function dragTo1000ThenShrink(page: Page, side: Side) {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await seed(page, [null, null], [null, null])
  await page.goto('/')
  await waitForTestHooks(page)
  await waitForMeasured(page, side)
  await dragHandle(page, 1000 - (await groupHeights(page, side)).top, side)
  await expect.poll(async () => Math.abs((await groupHeights(page, side)).top - 1000)).toBeLessThanOrEqual(1)
  const stored = (await storedHeights(page, side))[0]
  await page.setViewportSize({ width: 1280, height: 600 })
  return stored
}

for (const side of ['left', 'right'] as const) {
  test(`short window: both groups keep the minimum, no overflow, and the drag comes back (${side})`, async ({ page }) => {
    const stored = await dragTo1000ThenShrink(page, side)

    await expect.poll(async () => (await groupHeights(page, side)).bottom).toBeGreaterThanOrEqual(MIN_GROUP_HEIGHT)
    expect((await groupHeights(page, side)).overflow).toBeLessThanOrEqual(1)
    expect((await storedHeights(page, side))[0]).toBe(stored)

    await page.setViewportSize({ width: 1280, height: 1400 })
    await expect.poll(async () => Math.abs((await groupHeights(page, side)).top - stored!)).toBeLessThanOrEqual(1)
    expect((await groupHeights(page, side)).gap).toBeLessThan(1)
  })
}

test('short window: a drag up moves the boundary from where it is drawn', async ({ page }) => {
  await dragTo1000ThenShrink(page, 'left')
  // Precondition: the upper group is drawn smaller than its stored 1000px.
  await expect.poll(async () => (await groupHeights(page)).top).toBeLessThan(900)
  const shown = (await groupHeights(page)).top

  await dragHandle(page, -100)
  await expect.poll(async () => Math.abs((await groupHeights(page)).top - (shown - 100))).toBeLessThanOrEqual(1)
})
